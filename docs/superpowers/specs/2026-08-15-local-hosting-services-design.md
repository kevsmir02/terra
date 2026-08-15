# Design: Local Hosting Services (v1, data services)

**Date:** 2026-08-15
**Status:** Approved for planning

## Summary

Terra gains an on-demand local service stack in the spirit of the XAMPP control panel: MariaDB or MySQL, PostgreSQL, Redis, Mailpit and Adminer, started and stopped from a new Settings tab and backed by Docker containers.

This covers XAMPP's service side and its phpMyAdmin equivalent, minus the web server, plus PostgreSQL, Redis and Mailpit, which XAMPP users install by hand today. The web server is excluded on purpose: a web server with nothing to serve does nothing, so adding one requires bind-mounting the user's project, which is where the risk lives. A database does not have that coupling.

Terra never bundles or downloads server binaries. It generates a Docker Compose project in its own app-data directory and drives it through the `docker compose` CLI, so a stopped stack costs zero RAM and zero disk beyond the images the user chose to pull.

Your application keeps running the way it does today, with `php artisan serve` or `pnpm dev` in a Terra terminal. Terra hosts the services those applications need, not the applications themselves.

## Scope

A larger Herd-style design was explored first: nginx plus PHP-FPM, per-space `.test` domains, wildcard DNS on Unix and a managed hosts block on Windows. It was descoped for v1 because every genuinely dangerous part of it lived there. See **Deferred** below, which preserves those decisions rather than discarding them.

**v1 contains no privileged operation, writes nothing into the user's project, and mutates nothing outside Docker's own storage.** That is the property being protected, and any change that breaks it is out of scope by definition.

## Goals

- Start and stop local development services from inside Terra, with no hand-written config.
- Preserve Terra's zero-cost-when-unused rule: no process, no probe, and nothing meaningful in the eager bundle until the feature is enabled.
- Persist database data across restarts.
- Report Docker's real state rather than a remembered one.

## Non-goals (v1)

| Excluded | Reason |
| --- | --- |
| Serving the user's code | Where the bind-mount and config-generation risk lives. Deferred. |
| `.test` domains and any DNS work | Requires elevated system mutation. Deferred. |
| nginx, Apache, PHP-FPM | Follows from not serving code. |
| HTTPS | Needs a local CA in the system trust store. |
| User-editable compose file | Terra must be able to assume it wrote what it reads. |
| Rootless podman | Detected and reported as unsupported, never silently attempted. |
| Remote Docker contexts | Out of scope while everything is loopback. |
| Automatic image updates | Tags are pinned; upgrades are a Terra release concern. |

## Decisions

| Decision | Choice |
| --- | --- |
| Binary provisioning | Docker containers, started on demand |
| Runtime driver | Terra-generated compose file, `docker compose` invoked argv-style |
| Lifecycle | Containers survive Terra exit; Terra reconciles on launch |
| Control surface | New Settings tab |
| Port exposure | Loopback only |

## Architecture

### Ownership split

The frontend owns configuration. The settings store (`tauri-plugin-store`) holds enabled services, engine choices and ports under a `services` key, exactly as `lspActivation` holds LSP state today. Rust holds no persistent config.

Every command receives a full `StackSpec` from the webview and revalidates it from scratch against the catalog. A `StackSpec` arriving over IPC is untrusted input, not a resumption of state Terra already blessed.

### Rust module: `src-tauri/src/modules/services/`

| File | Purity | Responsibility |
| --- | --- | --- |
| `catalog.rs` | pure | Service definitions: pinned image tags, default ports, volumes, env, healthchecks. No IO. |
| `spec.rs` | pure | `StackSpec`, `ServiceId`, `Engine`. Validates an IPC-supplied spec against the catalog. |
| `compose.rs` | pure | `render_compose(&StackSpec) -> String`. The functional core. |
| `status.rs` | pure | Parses `docker compose ps --format json` into per-service state and health. |
| `runtime.rs` | IO | Locates `docker`, probes daemon reachability and the compose plugin, runs compose argv-style. |
| `state.rs` | IO | `ServicesState`: log-stream children and in-flight operations, behind `sync.rs` helpers. |
| `commands.rs` | thin | Tauri commands. |

Commands: `services_runtime_probe`, `services_status`, `services_up`, `services_down`, `services_logs` (streams over a `Channel`), `services_delete_data`.

### Catalog

| Service | Image | Default host port | Notes |
| --- | --- | --- | --- |
| MySQL-compatible database | `mariadb` or `mysql`, tag pinned | 3306 | One row with an engine selector. The two engines share port 3306 and are mutually exclusive. |
| PostgreSQL | `postgres`, tag pinned | 5432 | |
| Redis | `redis`, alpine, tag pinned | 6379 | No persistence configured; it is a dev cache. |
| Mailpit | `axllent/mailpit`, tag pinned | 8025 web, 1025 SMTP | |
| Adminer | `adminer`, tag pinned | 8026 | Database GUI. XAMPP's phpMyAdmin equivalent, chosen over phpMyAdmin because it is far smaller and speaks MariaDB, MySQL and PostgreSQL rather than only the MySQL half of the catalog. |

Each entry declares a healthcheck (`pg_isready`, `redis-cli ping`, the MariaDB health script), so the UI can distinguish "container running" from "actually accepting connections". Databases get named volumes; Redis, Mailpit and Adminer do not.

The two web UIs sit at 8025 and 8026 rather than the conventional 8080, which is heavily contested by dev servers and would make a port conflict the most common first experience of the feature.

Adminer reaches databases over the compose network by service name, so it needs no host ports of theirs and no credentials of its own. `ADMINER_DEFAULT_SERVER` is rendered to point at whichever database engine is enabled. Adminer therefore **depends on at least one database being enabled**, which is the only inter-service dependency in the catalog.

### Generated artifacts

Everything generated lives under `dirs::data_dir()/terra/services/`, never in the user's project:

```
services/
  compose.yaml
```

The compose project name is `terra`. Named volumes follow `terra_<service>_data`.

### Data flow

1. User opens the Services tab. The webview calls `services_runtime_probe` once.
2. On start, the webview sends a `StackSpec`. Rust validates it, renders `compose.yaml`, then runs `docker compose up -d <service>`.
3. Status comes from `docker compose ps --format json`, parsed into per-service state and health.
4. On next launch Terra runs the same `ps` and reconciles. **Container state is the truth; the settings store is a cache.**

On `RunEvent::Exit`, `ServicesState` kills any `docker compose logs -f` children it spawned, using the same process-group kill on Unix and `proc::job::ProcessJob` on Windows that the LSP and PTY modules use. It does **not** stop containers. This is the one place Terra deliberately departs from the kill-everything-on-exit pattern of `PtyState` and `LspState`, and it follows from the lifecycle decision above.

### Platform differences

Because v1 mounts no host paths, the platform surface is small:

| Concern | Behaviour |
| --- | --- |
| Docker location | `docker` on PATH; on Windows also the Docker Desktop install path |
| Daemon down | A distinct reported state, with a "Start Docker Desktop" action on Windows and macOS and the exact `systemctl` line on Linux |
| Named volumes | Managed entirely by Docker on every platform, so no uid mapping and no WSL path translation |

## Security

v1 spawns long-lived processes, so it sits alongside PTY and LSP spawn, but it passes no user-controlled path to the disk.

1. **No user paths reach the compose file.** Storage is Docker named volumes. `WorkspaceRegistry` is therefore not involved in v1, and any future change that introduces a bind mount must add that gate before it lands.
2. **Loopback-only publishing.** Every published port renders as `127.0.0.1:<port>:<port>`. A bare `3306:3306` publishes on all interfaces and bypasses the host firewall, which would put a development database on the local network. This matters most for Adminer, which is an unauthenticated-by-default full database administration surface: published beyond loopback it is a hand-over of every database Terra runs.
3. **Catalog validation.** Service names, engine choices and ports arriving from IPC are validated against catalog enums before reaching an image tag or a port mapping, in the same spirit as `ensure_safe_serial` in the device module.
4. **No shell.** `docker compose` is invoked argv-style. Nothing generated passes through a shell.
5. **Credentials.** Database passwords are generated once, stored in the settings store, and shown with a copy action. An initial database named `terra` is created on first start.

## UI

A new **Services** tab in Settings. `open_settings_window` already accepts a `tab` argument, so the statusbar pill deep-links into it.

1. **Runtime card.** Three distinct states, because conflating them is the top support question for anything Docker-backed: not installed (documentation link, never an auto-install), installed but daemon down (with the platform-appropriate start action), or ready with version shown.
2. **Service rows.** Icon, engine or version selector, port field, health dot, toggle. A toggle maps to `docker compose up -d <service>`, so services start independently. A "Delete data" action removes the named volume behind an explicit confirmation naming the volume.
3. **Connection details.** Host, port, user, generated password and a ready-to-paste connection string per running service, with copy actions. This is the difference between a service that is running and a service you can use. The two web UIs, Mailpit and Adminer, show an Open action instead, which reuses the existing preview tab.
4. **Logs drawer.** `docker compose logs -f` streamed over a `Channel`, collapsible, per service. Not a new tab kind.

The entire `src/modules/services/` frontend sits behind a lazy import, as the LSP module does. The eager bundle carries only the statusbar pill's gate, which reads one boolean from the settings store. The pill renders only while a service is running.

**Polling.** Status is polled only while the Services tab is open or a start or stop is in flight. There is no background poller.

## Failure handling

| Failure | Behaviour |
| --- | --- |
| Docker not installed | Runtime card explains and links docs; no other control is actionable |
| Daemon not running | Distinct state with a platform-appropriate start action |
| Published port already in use | Preflight `TcpListener` bind on `127.0.0.1` per port before `up`. Abort naming the port, and offer to change it |
| Both database engines enabled | Rejected in `spec.rs`; the UI presents them as one row with a selector so it cannot normally be expressed |
| Adminer enabled with no database | Row is disabled with the reason shown inline, and `spec.rs` rejects the combination rather than starting a GUI that can connect to nothing |
| Image pull slow on first start | Pull progress streamed into the service row |
| Container exits unhealthy | Health dot plus the last log lines inline, not a toast that scrolls away |
| Volume deletion | Confirmation naming the exact volume; never implied by stopping a service |

## Testing

This touches process spawn, so TERRA.md requires tests that lock the invariants. All of these run against the pure core with no Tauri runtime.

- `compose::render` snapshot: deterministic key ordering, correct volumes, correct healthchecks.
- Every published port renders with a `127.0.0.1:` prefix. This is a regression test, not a nicety.
- Only enabled services appear in the rendered file.
- `spec.rs` rejects an unknown service name, an out-of-enum engine, an out-of-range port, and both database engines at once.
- `status.rs` parses real `docker compose ps --format json` fixtures, including a container that is running but unhealthy, and a malformed line.
- Named volumes are stable across a render cycle, so a re-render cannot orphan a user's data.
- Adminer renders `ADMINER_DEFAULT_SERVER` pointing at the enabled engine, and `spec.rs` rejects Adminer with no database enabled.

## Phases

1. Runtime probe, Settings tab shell, runtime status card. No containers. Proves the zero-cost gating and the lazy import.
2. Pure core with full tests: catalog, spec validation, compose renderer, status parser. No UI wiring.
3. Up, down, status, connection details, logs drawer, statusbar pill, delete data.

## Success criteria

- With the feature untouched, Terra's startup does no Docker probe and the eager bundle grows by less than 2 kB.
- With the stack stopped, Terra's own RAM and CPU are unchanged from today.
- Enabling MariaDB and connecting from an external client on `127.0.0.1:3306` works using the credentials shown in the tab, with nothing edited by hand.
- Quitting and relaunching Terra leaves services running and the UI reporting them accurately.
- No file outside `dirs::data_dir()/terra/services/` is written on any platform.
- Every invariant in the Testing section has a test that fails when the invariant is broken.

## Deferred

Recorded so the v2 conversation starts from decisions already made rather than from scratch. These were explored and agreed before v1 was narrowed.

- **Serving code.** nginx plus PHP-FPM. The space root, not the docroot, mounts at `/sites/<slug>` in both containers at identical paths, with nginx `root` at `/sites/<slug>/<docroot>`. Mounting only the docroot breaks Laravel, whose `public/index.php` reaches into `../vendor`. Requires `user:` uid mapping on Linux to avoid root-owned files in the working tree, and `extra_hosts: host-gateway` on Linux for proxy sites.
- **PHP images.** `php:<v>-fpm-alpine` ships without `pdo_mysql`, `gd`, `zip` and `intl`, so a generated Dockerfile per version is needed, using a pinned `mlocati/php-extension-installer` and `COPY --from=composer:2`.
- **Site detection.** Ordered rules over the space root, where `artisan` must beat `package.json` so Laravel does not resolve as a Node proxy site.
- **Domains.** Slug from space name, ASCII, 63-character DNS label limit, stored per site rather than recomputed, so renaming a space cannot silently break `.env` files and OAuth callbacks.
- **DNS.** Wildcard on Unix via a NetworkManager dnsmasq drop-in, a systemd-resolved drop-in, or `/etc/resolver/test` on macOS, elevated once. Windows has no wildcard mechanism at all and needs a marker-delimited hosts block rewritten wholesale per site-list change, elevated each time, which conflicts with Terra's `currentUser` NSIS install mode.
- **Workspace authorization.** The moment a host path enters the compose file it must be canonicalized through `authorized_read`, with the canonical string being the one written into the YAML, and containment checked component-wise via `Path::starts_with`.
