# Design: Local Hosting Services

**Date:** 2026-08-15
**Status:** Approved for planning

## Summary

Terra gains an on-demand local web stack in the spirit of XAMPP: nginx plus PHP-FPM serving a Terra space, alongside MariaDB, PostgreSQL, Redis, Mailpit and Adminer. Everything is started and stopped from a new Settings tab and backed by containers, run through either Docker or Podman.

Terra never bundles or downloads server binaries. It generates a Compose project in its own app-data directory and drives it through the `compose` CLI, so a stopped stack costs zero RAM and zero disk beyond the images the user chose to pull.

Sites are served at `http://localhost:<port>`. There are no `.test` domains and no DNS work of any kind in this release.

## Goals

- Serve a PHP project from a Terra space with no hand-written server config.
- Start and stop the services a web project needs, on demand and independently.
- Ship **current** versions. XAMPP's perennially stale bundle is a large part of why people leave it; pinned tags are bumped per Terra release.
- Preserve Terra's zero-cost-when-unused rule: no process, no probe, and nothing meaningful in the eager bundle until the feature is enabled.
- Persist database data across restarts.
- Report the runtime's real state rather than a remembered one.

## Provisioning: why containers

Recorded because it is the load-bearing decision and deserves to be findable later.

| Option | Verdict |
| --- | --- |
| Bundle binaries in Terra | **Rejected.** XAMPP is ~150 MB of Apache, MariaDB and PHP. Terra's bundle is 7-8 MB. TERRA.md calls ultra-lightweight "the product"; this is a 20x violation of it, not a tension to manage. |
| Terra-managed native downloads (the Herd model) | **Rejected.** Sounds lighter than containers, is not. It requires a per-OS and per-arch artifact matrix, checksum and signature verification, unpack, version pinning, upgrades, and native process supervision with config generation for five services. That is a package manager inside a terminal IDE, and strictly more Terra code than the container path. The matrix also has holes that do not close: Redis has no supported native Windows build, and MariaDB on macOS ARM realistically means Homebrew. |
| Containers via Docker or Podman | **Chosen.** Terra writes YAML and shells out. Zero new Rust dependencies, mature supervision, current images, and nothing to maintain per platform. |

**The accepted tradeoff:** the feature's floor is a container runtime Terra does not ship. This is the LSP module's pattern (an external binary Terra does not ship, with an honest "not installed" state) with a larger number attached. It is mitigated, not eliminated, by supporting Podman: rootless, daemonless, no VM on Linux, and preinstalled on Fedora and RHEL. Every port in this design is above 1024, so rootless Podman needs no privileged-port configuration.

A hybrid where trivially-portable services ship natively (Mailpit is one Go binary) was considered and rejected: one mechanism that always works beats two that each work sometimes.

## Non-goals

| Excluded | Reason |
| --- | --- |
| `.test` domains and all DNS work | The only part requiring elevated system mutation. Deferred. |
| HTTPS | Needs a local CA in the system trust store plus a cert lifecycle. |
| Apache | nginx covers the same ground with simpler generated config. |
| Proxy sites for Node | Pointless without domains; the preview tab already covers it. |
| Live log streaming | Terra is a terminal. `compose logs -f` in a terminal tab is the right tool; reimplementing a log tailer inside a settings panel is not. |
| Multiple PHP versions | One latest-stable version in v1. Added when a real project needs an older one. |
| MySQL alongside MariaDB | XAMPP ships MariaDB and it is drop-in compatible for local development. |
| User-editable compose file | Terra must be able to assume it wrote what it reads. |
| Remote container contexts | Bind mounts assume a local filesystem. |
| Automatic image updates | Tags are pinned; upgrades are a Terra release concern. |

## Decisions

| Decision | Choice |
| --- | --- |
| Provisioning | Containers, started on demand |
| Runtime | Docker or Podman, auto-detected, user-overridable |
| Runtime driver | Terra-generated compose file, `<runtime> compose` invoked argv-style |
| Web server | nginx plus a single PHP-FPM container |
| Site addressing | `localhost:<assigned port>`, no DNS |
| Site definition | Auto-detected per space, overridable |
| Lifecycle | Containers survive Terra exit; Terra reconciles on launch |
| Control surface | New Settings tab |
| Port exposure | Loopback only |

## Architecture

### Ownership split

The frontend owns configuration. The settings store (`tauri-plugin-store`) holds the chosen runtime, enabled services, ports and the site list under a `services` key, exactly as `lspActivation` holds LSP state today. Rust holds no persistent config.

Every command receives a full `StackSpec` from the webview and revalidates it from scratch: catalog membership, port ranges, and workspace authorization of every mounted path. A `StackSpec` arriving over IPC is untrusted input, not a resumption of state Terra already blessed.

### Rust module: `src-tauri/src/modules/services/`

| File | Purity | Responsibility |
| --- | --- | --- |
| `catalog.rs` | pure | Service definitions: pinned image tags, default ports, volumes, env, healthchecks. No IO. |
| `spec.rs` | pure | `StackSpec`, `Site`, `SiteKind`, `HostPlatform`. Validates an IPC-supplied spec against the catalog. |
| `compose.rs` | pure | `render_compose(&StackSpec, HostPlatform) -> String`. The functional core. |
| `dockerfile.rs` | pure | `render_php_dockerfile() -> String`. |
| `vhost.rs` | pure | `render_vhosts(&[Site]) -> String`. Slug, path and port sanitization. |
| `detect.rs` | pure | `detect_site(&DirListing) -> SiteKind`. |
| `status.rs` | pure | Parses `compose ps --format json` into per-service state and health. |
| `runtime.rs` | IO | Selects and probes the container runtime, runs compose argv-style. |
| `state.rs` | IO | Tracks in-flight compose invocations so they can be killed on exit. Nothing else. |
| `commands.rs` | thin | Tauri commands. |

Commands: `services_runtime_probe`, `services_status`, `services_up`, `services_down`, `services_logs`, `services_delete_data`, `sites_detect`.

### Container runtime selection

`runtime.rs` probes in three steps, because each failure needs a different message:

1. The binary exists (`docker`, then `podman`; on Windows also the Docker Desktop install path).
2. `<bin> compose version` succeeds. Podman delegates compose to an external provider, so a working `podman` with no compose provider is a real and distinguishable state.
3. `<bin> info` succeeds, meaning the daemon or rootless service is reachable.

Docker is preferred when both are usable, since it is the more common setup; the user can override and the choice is stored. Nothing else in the module knows which runtime was chosen: every call site uses the resolved binary name.

### Catalog

| Service | Image | Default host port | Notes |
| --- | --- | --- | --- |
| nginx | `nginx`, alpine, tag pinned | one per site, from 8000 | Serves every site from one container. |
| PHP-FPM | generated, see below | none published | Single container, latest stable PHP. |
| MariaDB | `mariadb`, tag pinned | 3306 | |
| PostgreSQL | `postgres`, tag pinned | 5432 | |
| Redis | `redis`, alpine, tag pinned | 6379 | No persistence configured; it is a dev cache. |
| Mailpit | `axllent/mailpit`, tag pinned | 8025 web, 1025 SMTP | |
| Adminer | `adminer`, tag pinned | 8026 | Database GUI, XAMPP's phpMyAdmin equivalent. Chosen over phpMyAdmin because it is far smaller and speaks both MariaDB and PostgreSQL rather than only the MySQL half of the catalog. |

Each entry declares a healthcheck (`pg_isready`, `redis-cli ping`, the MariaDB health script), so the UI can distinguish "container running" from "actually accepting connections". Databases get named volumes; nothing else does.

The two web UIs sit at 8025 and 8026, and sites start at 8000, all away from the conventional 8080, which is heavily contested by dev servers and would make a port conflict the most common first experience of the feature.

Adminer reaches databases over the compose network by service name, so it needs no host ports of theirs and no credentials of its own. `ADMINER_DEFAULT_SERVER` is rendered to MariaDB when enabled, otherwise PostgreSQL, which makes Adminer the one catalog entry with a dependency: it requires at least one database.

All tags are pinned in `catalog.rs` and **verified against current upstream releases at implementation time**, not carried over from this document.

### PHP image

The official `php:<v>-fpm-alpine` image ships without `pdo_mysql`, `gd`, `zip` and `intl`, so Terra generates one Dockerfile:

- `FROM php:<latest stable>-fpm-alpine`, tag pinned in the catalog.
- Extensions installed with a pinned `mlocati/php-extension-installer` copied in via `COPY --from`.
- Fixed extension set: `pdo_mysql pdo_pgsql mbstring bcmath intl zip gd exif pcntl opcache redis`.
- Composer via `COPY --from=composer:2`.
- A rendered `terra-dev.ini` setting `opcache.validate_timestamps=1` and `opcache.revalidate_freq=0`, plus `display_errors=On` and a raised `upload_max_filesize`.

That ini file is not optional polish. opcache's defaults revalidate on a timer, so without it a saved file can take seconds to appear in the browser, and some base images ship production-shaped opcache settings where it never appears at all. "I saved and nothing changed" would otherwise be the single most common report against this feature.

Compose uses `build:` for it. The first enable pays a one-time build; every later start is a cache hit.

### Generated artifacts

Everything generated lives under `dirs::data_dir()/terra/services/`, never in the user's project:

```
services/
  compose.yaml
  nginx/conf.d/sites.conf
  php/Dockerfile
  php/terra-dev.ini
```

The compose project name is `terra`. Named volumes follow `terra_<service>_data`.

### Site detection

`detect_site` runs over a directory listing of the space root, in this order. Order matters: a Laravel project has both `artisan` and `package.json`, and must resolve as PHP.

| Condition | Result |
| --- | --- |
| `artisan` and `public/` present | `Php { docroot: "public" }` |
| `composer.json` and `public/` present | `Php { docroot: "public" }` |
| `composer.json` present | `Php { docroot: "." }` |
| `index.php` at root | `Php { docroot: "." }` |
| `index.html` at root | `Static { docroot: "." }` |
| otherwise | `Static { docroot: "." }`, flagged in the UI as a guess |

Detection is advisory. The resolved kind and docroot are editable per site, and the override wins.

### Site serving

The **space root**, not the docroot, is mounted at `/sites/<slug>` in **both** the nginx and the PHP-FPM container at the identical path, and nginx `root` points at `/sites/<slug>/<docroot>`.

Mounting only the docroot would break every Laravel project, because `public/index.php` reaches up into `../vendor` and `../bootstrap`. The two mount paths must be identical because nginx passes `SCRIPT_FILENAME` as a path the FPM container resolves itself, so a mismatch produces a "file not found" that reads like a config bug.

Each site is assigned a stable host port from 8000 upward, stored per site so it survives renames and reordering. nginx publishes one loopback port per site and renders one server block per site.

### Data flow

1. User opens the Services tab. The webview calls `services_runtime_probe` once.
2. For each space, `sites_detect` returns a detected `SiteKind`. The webview merges stored overrides and writes the result to the settings store.
3. On start, the webview sends a `StackSpec`. Rust validates it, authorizes every mounted path, renders `compose.yaml`, the vhost config and the Dockerfile, then runs `compose up -d`.
4. Status comes from `compose ps --format json`, parsed into per-service state and health.
5. On next launch Terra runs the same `ps` and reconciles. **Container state is the truth; the settings store is a cache.**

On `RunEvent::Exit`, `ServicesState` kills any compose invocation still in flight, using the same process-group kill on Unix and `proc::job::ProcessJob` on Windows that the LSP and PTY modules use. It does **not** stop containers. This is the one place Terra deliberately departs from the kill-everything-on-exit pattern of `PtyState` and `LspState`, and it follows from the lifecycle decision above.

### Platform differences

`compose.rs` stays pure by taking `HostPlatform` as an input rather than reading the ambient OS:

| Concern | Linux | macOS | Windows |
| --- | --- | --- | --- |
| `user:` uid mapping | required | omit | omit |
| Mount source | canonical space root | canonical space root | WSL path via the existing bridge when the space env is WSL, else the `C:` path |
| Runtime location | `docker` or `podman` on PATH | same | also the Docker Desktop install path |

**uid mapping is the sharpest edge in this design.** Without it, `composer install` running in the container leaves root-owned files in the user's working tree, which is miserable to undo by hand. Terra renders `user: "<uid>:<gid>"` on Linux, deriving both from the **metadata of the space root itself** via `std::os::unix::fs::MetadataExt`, which needs no new dependency and is more correct than the process uid: it matches the ownership of the files actually being mounted. Docker Desktop synthesizes ownership, so setting `user:` there would break it. Rootless Podman already maps the host user into the container, so it takes the same treatment as Docker Desktop.

On Windows, a space on `C:` bind-mounts across the WSL2 boundary through `/mnt/c`, where PHP's many-small-file access pattern is slow. That is a Docker Desktop property, not something Terra can fix, so the Sites table labels such a site as a slow mount and points at using a WSL space instead. Terra does not silently disappoint.

## Security

This spawns long-lived processes and hands containers write access to a project tree, so it sits on the same footing as PTY spawn and LSP spawn.

1. **Mount authorization.** Every mounted space root is canonicalized through `WorkspaceRegistry::authorized_read` before it becomes a compose volume, and **the canonical path is the string written into the YAML**. This is the rule `shell_run_command` already follows: check and use must be the same string, or the gap between them is a symlink-swap window.
2. **Containment.** After canonicalization the docroot must resolve inside its space root, compared component-wise with `Path::starts_with`, never a string prefix.
3. **Slug sanitization.** A space named `foo bar`, `../evil` or `a/b` must be slugged or rejected, never emitted into a mount path, a `root` directive or a second server block.
4. **Catalog validation.** Service names and ports arriving from IPC are validated against catalog enums before reaching an image tag or a port mapping, in the same spirit as `ensure_safe_serial` in the device module.
5. **No shell.** Compose is invoked argv-style. Nothing generated passes through a shell.
6. **Loopback-only publishing.** Every published port renders as `127.0.0.1:<port>:<port>`. A bare `3306:3306` publishes on all interfaces and bypasses the host firewall. This matters most for Adminer, which is an unauthenticated-by-default full database administration surface: published beyond loopback it hands over every database Terra runs.
7. **Credentials.** Database passwords are generated once, stored in the settings store, and shown with a copy action. An initial database named `terra` is created on first start.

## UI

A new **Services** tab in Settings. `open_settings_window` already accepts a `tab` argument, so the statusbar pill deep-links into it.

1. **Runtime card.** Four distinct states, matching the three probe steps plus success, because conflating them is the top support question for anything container-backed: no runtime found (documentation links for Docker and Podman, never an auto-install), runtime present but no compose provider, runtime present but daemon or service unreachable (with a "Start Docker Desktop" action on Windows and macOS and the exact `systemctl` line on Linux), or ready with the runtime name and version shown. A control lets the user switch runtime when both are usable.
2. **Service rows.** Icon, port field, health dot, toggle. A toggle maps to `compose up -d <service>`, so services start independently. A "Delete data" action removes the named volume behind an explicit confirmation naming the volume.
3. **Sites table.** Space, assigned URL, detected-kind badge, docroot, override control, slow-mount warning where applicable, and an Open action that reuses the existing preview tab via `newPreviewTab(url)`.
4. **Connection details.** Host, port, user, generated password and a ready-to-paste connection string per running service, with copy actions. This is the difference between a service that is running and a service you can use. Mailpit and Adminer show an Open action instead.
5. **Logs drawer.** `compose logs --tail 200 <service>` fetched on demand, with a Refresh button, plus a hint that `compose logs -f` in a terminal tab gives a live tail. No streaming, no long-lived children.

The entire `src/modules/services/` frontend sits behind a lazy import, as the LSP module does. The eager bundle carries only the statusbar pill's gate, which reads one boolean from the settings store. The pill renders only while a service is running.

**Polling.** Status is polled only while the Services tab is open or a start or stop is in flight. There is no background poller.

## Failure handling

| Failure | Behaviour |
| --- | --- |
| No container runtime found | Runtime card explains and links both Docker and Podman; no other control is actionable |
| Runtime present, no compose provider | Distinct state naming the provider to install, since a bare `podman` hits this |
| Daemon or rootless service unreachable | Distinct state with a platform-appropriate start action |
| Published port already in use | Preflight `TcpListener` bind on `127.0.0.1` per port before `up`. Abort naming the port, and offer to change it |
| Adminer enabled with no database | Row disabled with the reason inline, and rejected in `spec.rs` rather than starting a GUI that can connect to nothing |
| First PHP build slow | The row shows a spinner stating this is a one-time build; the captured output lands in the logs drawer on completion |
| Container exits unhealthy | Health dot plus the tail of its log inline, not a toast that scrolls away |
| Volume deletion | Confirmation naming the exact volume; never implied by stopping a service |
| Open pressed while the site's stack is down | Open is disabled with the reason inline, rather than opening a preview tab onto a connection refused |

## Testing

This touches process spawn and workspace authorization, so TERRA.md requires tests that lock the invariants. All of these run against the pure core with no Tauri runtime.

- `compose::render` snapshots per `HostPlatform`. Identical `StackSpec` in, correct platform-specific YAML out, deterministic key ordering.
- `user:` is rendered on Linux and absent on Docker Desktop and rootless Podman.
- Only enabled services appear in the rendered file.
- Every published port renders with a `127.0.0.1:` prefix. This is a regression test, not a nicety.
- The nginx and PHP-FPM mount paths for a given site are byte-identical.
- The mounted path is the space root and the nginx `root` is the space root joined with the docroot, so a Laravel `public` docroot still exposes `../vendor` to PHP.
- The rendered dev ini sets `opcache.validate_timestamps=1` and `opcache.revalidate_freq=0`, so an edit is visible on the next request.
- `detect_site` table tests over fixture listings, including the Laravel case where `artisan` must beat `package.json`.
- `vhost::render` sanitization: `foo bar`, `../evil`, `a/b`, unicode, empty, and a 200-character name. Never emits a path fragment or a second server block.
- Port assignment is stable across a rename and does not collide with a catalog port.
- Authorization: a docroot resolving outside its space root is rejected; a symlinked space root is canonicalized before it reaches the YAML; an assertion that the string checked is byte-identical to the string emitted.
- `spec.rs` rejects an unknown service, an out-of-range port, and Adminer with no database.
- `status.rs` parses real `compose ps --format json` fixtures from both Docker and Podman, including a running-but-unhealthy container and a malformed line.
- Named volumes are stable across a render cycle, so a re-render cannot orphan a user's data.

## Phases

Ordered so each phase ships something usable, and the riskiest work (bind mounts) lands after the mount-free half is proven.

1. Runtime selection and probe, Settings tab shell, runtime card. No containers. Proves the zero-cost gating and the lazy import.
2. Pure core for services, with full tests: catalog, spec validation, compose renderer, status parser. No UI wiring.
3. Data services end to end: up, down, status, connection details, Adminer, logs drawer, delete data. Useful on its own, and `localhost:3306` works from here on.
4. Pure core for the web tier, with full tests: Dockerfile renderer, vhost renderer, site detection, slug and port assignment. No UI wiring.
5. nginx plus PHP-FPM: mount authorization, uid mapping, site serving at `localhost:<port>`, Sites table.
6. Statusbar pill and preview-tab integration.

## Success criteria

- With the feature untouched, Terra's startup does no runtime probe and the eager bundle grows by less than 2 kB.
- With the stack stopped, Terra's own RAM and CPU are unchanged from today.
- The feature works end to end on both Docker and rootless Podman.
- Enabling MariaDB and connecting from an external client on `127.0.0.1:3306` works using the credentials shown in the tab, with nothing edited by hand.
- A fresh Laravel project in a Terra space is reachable at its assigned `localhost` port after enabling nginx, PHP and MariaDB, with no file edited by hand.
- Editing a `.php` file in Terra and reloading the preview tab shows the change on the next request, with no container restart.
- On Linux, `composer install` run through the PHP container leaves files owned by the user, not root.
- Quitting and relaunching Terra leaves services running and the UI reporting them accurately.
- No file outside `dirs::data_dir()/terra/services/` and the user's own mounted project is written on any platform.
- Every invariant in the Testing section has a test that fails when the invariant is broken.

## Deferred

Recorded so the next conversation starts from decisions already made rather than from scratch.

- **`.test` domains.** Wildcard DNS on Unix via a NetworkManager dnsmasq drop-in, a systemd-resolved drop-in, or `/etc/resolver/test` on macOS, elevated once. Windows has no wildcard mechanism at all and needs a marker-delimited hosts block rewritten wholesale per site-list change, elevated each time, which conflicts with Terra's `currentUser` NSIS install mode. Domains would be slugged from the space name, ASCII, within the 63-character DNS label limit, and stored per site rather than recomputed, so renaming a space cannot silently break `.env` files and OAuth callbacks.
- **HTTPS.** Requires a local CA installed into the system trust store plus a certificate lifecycle. Depends on the DNS work landing first.
- **Multiple PHP versions.** A version enum, a per-site selector, and one FPM container per version in use. Add when a real project needs an older runtime.
- **Live log streaming.** A `Channel`-backed tail with the long-lived child management that implies, if the on-demand tail proves insufficient in practice.
- **Proxy sites for Node.** Only worth building once domains exist. Would need `extra_hosts: host-gateway` on Linux and a custom 502 page naming the expected port.
