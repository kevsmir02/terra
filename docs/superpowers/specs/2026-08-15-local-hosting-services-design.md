# Design: Local Hosting Services

**Date:** 2026-08-15
**Status:** Approved for planning

## Summary

Terra gains a container-backed local hosting stack in the spirit of XAMPP and Laravel Herd: nginx plus PHP-FPM, MariaDB, PostgreSQL, Redis and Mailpit, started and stopped on demand from a new Settings tab, with each Terra space reachable at `<domain>.test`.

Terra never bundles or downloads server binaries. It generates a Docker Compose project and drives it through the `docker compose` CLI, so a stopped stack costs exactly zero RAM and zero disk beyond the images the user chose to pull.

## Goals

- Start and stop a local web stack without leaving Terra, with no hand-written config.
- Serve each Terra space at a stable `.test` domain, HTTP.
- Support PHP projects (Laravel first) and Node projects that run their own dev server.
- Preserve Terra's zero-cost-when-unused rule: no process, no probe, and nothing meaningful in the eager bundle until the feature is enabled.
- Keep every path that reaches the disk inside the existing `WorkspaceRegistry` gate.

## Non-goals (v1)

| Excluded | Reason |
| --- | --- |
| HTTPS on `.test` | Needs a local CA in the system trust store plus a cert lifecycle. Second privileged mutation, deferred. |
| Apache | nginx covers the same ground with simpler generated config. |
| User-editable compose file | Terra must be able to assume it wrote what it reads. |
| Rootless podman | Cannot bind `:80` while `net.ipv4.ip_unprivileged_port_start` is 1024. Detected and reported as unsupported, never silently attempted. |
| Remote Docker contexts | Bind mounts assume a local filesystem. |
| Automatic image updates | Tags are pinned; upgrades are a Terra release concern. |

## Decisions

| Decision | Choice |
| --- | --- |
| Binary provisioning | Docker containers, started on demand |
| Hosting model | Services plus auto `.test` domains (Herd-style) |
| DNS on Unix | Wildcard, one explicitly confirmed elevated setup |
| DNS on Windows | Per-site hosts entries, batched behind one UAC prompt per change |
| Runtime driver | Terra-generated compose file, `docker compose` invoked argv-style |
| Site definition | Auto-detected per space, overridable |
| Lifecycle | Containers survive Terra exit; Terra reconciles on launch |
| Control surface | New Settings tab |

## Architecture

### Ownership split

The frontend owns configuration. The settings store (`tauri-plugin-store`) holds the enabled services, versions, ports and site list under a `services` key, exactly as `lspActivation` holds LSP state today. Rust holds no persistent config.

Every command that acts on the stack receives a full `StackSpec` from the webview and revalidates it from scratch: catalog membership, port ranges, domain shape, and workspace authorization of every docroot. A `StackSpec` arriving over IPC is untrusted input, not a resumption of state Terra already blessed.

### Rust module: `src-tauri/src/modules/services/`

| File | Purity | Responsibility |
| --- | --- | --- |
| `catalog.rs` | pure | Service definitions: pinned image tags, default ports, volumes, env, healthchecks. Version enums. No IO. |
| `spec.rs` | pure | `StackSpec`, `Site`, `SiteKind`, `HostPlatform`. Validation of an IPC-supplied spec against the catalog. |
| `compose.rs` | pure | `render_compose(&StackSpec, HostPlatform) -> String`. The functional core. |
| `dockerfile.rs` | pure | `render_php_dockerfile(PhpVersion) -> String`. |
| `vhost.rs` | pure | `render_vhosts(&[Site], HostPlatform) -> String`. Domain and path sanitization. |
| `detect.rs` | pure | `detect_site(&DirListing) -> SiteKind`. |
| `dns/mod.rs` | mixed | `DnsStrategy` trait, platform selection, live resolution probe. |
| `dns/unix.rs` | mixed | Wildcard install for NetworkManager-dnsmasq, systemd-resolved and macOS resolver. |
| `dns/windows.rs` | mixed | Hosts block render and elevated replace. |
| `runtime.rs` | IO | Locate `docker`, probe daemon reachability and compose plugin, run compose argv-style, parse `ps --format json`. |
| `state.rs` | IO | `ServicesState`: log-stream children and in-flight operations, behind `sync.rs` helpers. |
| `commands.rs` | thin | Tauri commands. |

Commands: `services_runtime_probe`, `services_status`, `services_up`, `services_down`, `services_restart`, `services_logs` (streams over a `Channel`), `services_prune_data`, `services_dns_status`, `services_dns_install`, `sites_detect`.

### Generated artifacts

All generated files live under `dirs::data_dir()/terra/services/`, never in the user's project:

```
services/
  compose.yaml
  nginx/conf.d/sites.conf
  nginx/html/terra-502.html
  php/<version>/Dockerfile
  hosts.staged           (Windows only)
  hosts.terra-backup     (Windows only, first write)
  dns-setup.sh           (Unix only, shown before elevation)
```

The compose project name is `terra`. One nginx container serves every site. One PHP-FPM container is rendered **per PHP version actually referenced by a site**, so enabling four versions in the catalog while using one costs one container.

### Data flow

1. User opens the Services tab. The webview calls `services_runtime_probe` once.
2. For each space, `sites_detect` returns a detected `SiteKind`; the webview merges stored overrides and writes the result to the settings store.
3. On start, the webview sends a `StackSpec`. Rust validates it, authorizes every docroot, renders `compose.yaml`, the vhost config and any Dockerfiles, then runs `docker compose up -d`.
4. Status comes from `docker compose ps --format json`, parsed into per-service state and health.
5. On next launch, Terra runs the same `ps` and reconciles. **Container state is the truth; the settings store is a cache.**

On `RunEvent::Exit`, `ServicesState` kills any `docker compose logs -f` children it spawned, using the same process-group kill on Unix and `proc::job::ProcessJob` on Windows that the LSP and PTY modules use. It does **not** stop containers. This is the one place Terra deliberately departs from the kill-everything-on-exit pattern of `PtyState` and `LspState`, and it follows from the lifecycle decision above.

### PHP images

The official `php:<v>-fpm-alpine` image ships without `pdo_mysql`, `gd`, `zip`, `intl` and the rest of what Laravel expects, so Terra generates a small Dockerfile per version:

- `FROM php:<version>-fpm-alpine`, tag pinned in the catalog.
- Extensions installed with a pinned `mlocati/php-extension-installer` copied in via `COPY --from`.
- Fixed extension set: `pdo_mysql pdo_pgsql mbstring bcmath intl zip gd exif pcntl opcache redis`.
- Composer via `COPY --from=composer:2`.

Compose uses `build:` for these. The first enable pays a one-time build, surfaced as build progress in the UI rather than an unexplained wait; every later start is cache-hit fast.

Supported versions: PHP 8.1, 8.2, 8.3, 8.4, as an enum. A version string arriving from IPC that is not in the enum is rejected in `spec.rs` before it can reach an image tag.

### Site detection

`detect_site` runs over a directory listing of the space root, in this order. Order matters: a Laravel project has both `artisan` and `package.json`, and must resolve as PHP.

| Condition | Result |
| --- | --- |
| `artisan` and `public/` present | `Php { docroot: "public" }` |
| `composer.json` and `public/` present | `Php { docroot: "public" }` |
| `composer.json` present | `Php { docroot: "." }` |
| `index.php` at root | `Php { docroot: "." }` |
| `package.json` present | `Proxy { port }`, 5173 if `vite` is a dependency, else 3000 |
| `index.html` at root | `Static { docroot: "." }` |
| otherwise | `Static { docroot: "." }`, flagged in the UI as a guess |

Detection is advisory. The resolved kind, docroot, PHP version and proxy port are all editable per site and the override wins.

### Site serving

- **PHP sites.** The **space root**, not the docroot, is mounted at `/sites/<slug>` in **both** the nginx and the PHP-FPM container at the identical path, and nginx `root` points at `/sites/<slug>/<docroot>`. Mounting only the docroot would break every Laravel project, because `public/index.php` reaches up into `../vendor` and `../bootstrap`. The paths must be identical in the two containers: nginx passes `SCRIPT_FILENAME` as a path the FPM container resolves itself, so a mismatch produces a "file not found" that reads like a config bug.
- **Proxy sites.** nginx `proxy_pass` to `host.docker.internal:<port>`. When no dev server is listening, `error_page 502` serves `terra-502.html`, which names the expected port instead of showing a bare nginx error.
- **Static sites.** `root` plus `try_files`.

### Domains

Space name to slug: lowercase, ASCII alphanumerics and hyphens, runs collapsed, leading and trailing hyphens trimmed, truncated to 63 characters (the DNS label limit). An empty result is rejected rather than substituted. Collisions get a `-2` suffix.

The domain is **stored per site once assigned**, initialized from the slug. Renaming a space offers to update the domain but never moves it silently, because a moved domain breaks bookmarks, `.env` files and OAuth callbacks.

### Platform differences

`compose.rs` stays pure by taking `HostPlatform` as an input rather than reading the ambient OS:

| Concern | Linux | macOS | Windows |
| --- | --- | --- | --- |
| `host.docker.internal` | needs `extra_hosts: host-gateway` | native | native |
| `user:` uid mapping | required, else containers write root-owned files into the repo | omit | omit |
| Mount source | canonical space root | canonical space root | WSL path via the existing bridge when the space env is WSL, else the `C:` path |

On Windows, a space on `C:` bind-mounts across the WSL2 boundary through `/mnt/c`, where PHP's many-small-file access pattern is slow. That is a Docker Desktop property, not something Terra can fix, so the Sites table labels such a site as a slow mount and points at using a WSL space instead. Terra does not silently disappoint.

### DNS

| | Linux (NetworkManager) | Linux (systemd-resolved) | macOS | Windows |
| --- | --- | --- | --- | --- |
| Mechanism | `/etc/NetworkManager/dnsmasq.d/terra-test.conf` with `address=/test/127.0.0.1`, plus `dns=dnsmasq` in `NetworkManager.conf` | resolved drop-in with `DNS=127.0.0.1` and `Domains=~test`, served by a dnsmasq container on `127.0.0.1:53` | `/etc/resolver/test`, served by a dnsmasq container on `127.0.0.1:53` | marked block in `%SystemRoot%\System32\drivers\etc\hosts` |
| Elevation | `pkexec /bin/sh dns-setup.sh`, once | same | `osascript` administrator prompt, once | `ShellExecuteW` verb `runas`, per site-list change |
| Rewrite trigger | never after setup | never after setup | never after setup | site added, removed or renamed |

The dnsmasq container is an internal service rendered only for the strategies that need it. It is not a catalog entry and is not user-toggleable.

When no supported resolver stack is detected on Linux, Terra falls back to showing the exact file contents and command for the user to run, then re-probes. It does not guess.

Status is always established by **resolving a probe name**, never by trusting a stored flag, so a `.test` setup removed by a system update is reported as broken rather than assumed working.

## Security

The stack spawns long-lived processes and hands containers write access to project trees, so it sits on the same footing as PTY spawn and LSP spawn.

1. **Docroot authorization.** Every docroot is canonicalized through `WorkspaceRegistry::authorized_read` before it becomes a compose volume, and **the canonical path is the string written into the YAML**. This is the rule `shell_run_command` already follows: check and use must be the same string, or the gap between them is a symlink-swap window.
2. **Containment.** After canonicalization the docroot must be inside its space root, compared component-wise with `Path::starts_with`, never a string prefix.
3. **Domain sanitization.** A space named `foo bar`, `../evil` or `a/b` must be slugged or rejected, never emitted into a `server_name`, a file path or a second server block.
4. **Catalog validation.** Versions and service names arriving from IPC are validated against the catalog enums before reaching an image tag, in the same spirit as `ensure_safe_serial` in the device module.
5. **No shell.** `docker compose` is invoked argv-style. Nothing generated is passed through a shell.
6. **Loopback-only publishing.** Every published port is bound as `127.0.0.1:<port>:<port>`. A bare `<port>:<port>` publishes on all interfaces and bypasses the host firewall, which would put a local database on the network.
7. **Hosts file replacement is wholesale.** The Terra block is delimited by markers and rewritten from Terra's own site list. A hand-edited, duplicated or truncated block is replaced, never merged, so a malformed hosts file cannot become a parsing exploit against an elevated writer. The original is copied to `hosts.terra-backup` before the first write.
8. **Minimal elevated surface.** The Windows elevated call is `cmd.exe /c copy /y "<appdata>\services\hosts.staged" "<system hosts path>"`. Both paths are Terra-owned constants. No user input is interpolated into an elevated command line on any platform; the Unix script is fully rendered and displayed before it runs.
9. **Credentials.** Database passwords are generated once, stored in the settings store, and shown with a copy action. Services bind loopback only.

## UI

A new **Services** tab in Settings. `open_settings_window` already accepts a `tab` argument, so the statusbar pill deep-links into it.

1. **Runtime card.** Three distinct states, because conflating them is the top support question for anything Docker-backed: not installed (documentation link, never an auto-install), installed but daemon down ("Start Docker Desktop" on Windows and macOS, the exact `systemctl` line on Linux), or ready with version shown.
2. **DNS card.** Live probe result. The setup action shows the exact file path and full contents before elevating. On Windows it reports how many hosts entries Terra manages.
3. **Service rows.** Icon, version selector, port field, health dot, toggle. A toggle maps to `docker compose up -d <service>`, so services start independently. A destructive "Delete data" action removes the named volume behind a confirmation.
4. **Sites table.** Space, domain, detected-kind badge, docroot, PHP version or proxy port, override control, slow-mount warning where applicable, and an Open action that reuses the existing preview tab.
5. **Logs drawer.** `docker compose logs -f` streamed over a `Channel`, collapsible, per service. Not a new tab kind in v1.

The entire `src/modules/services/` frontend sits behind a lazy import, as the LSP module does. The eager bundle carries only the statusbar pill's gate, which reads one boolean from the settings store. The pill renders only while a stack is running.

**Polling.** Status is polled only while the Services tab is open or a start or stop is in flight. There is no background poller.

## Failure handling

| Failure | Behaviour |
| --- | --- |
| Docker not installed | Runtime card explains, links docs, no other UI is actionable |
| Daemon not running | Distinct state with a platform-appropriate start action |
| Published port already in use | Preflight `TcpListener` bind on `127.0.0.1` per port before `up`. Abort naming the port. On Windows, port 80 failures additionally name IIS and WinNAT reserved ranges as the usual causes |
| First PHP build slow | Build output streamed into the service row as progress |
| Dev server not running for a proxy site | `terra-502.html` naming the expected port |
| `.test` stops resolving | Probe reports broken, offers re-run of setup |
| Container exits unhealthy | Health dot plus the last log lines inline, not a toast that scrolls away |

## Testing

This touches process spawn and workspace authorization, so TERRA.md requires tests that lock the invariants. All of these run against the pure core with no Tauri runtime.

- `compose::render` snapshots per `HostPlatform`. Identical `StackSpec` in, correct platform-specific YAML out, with deterministic key ordering.
- Only PHP versions referenced by a site render an FPM service.
- Every published port renders with a `127.0.0.1:` prefix. This is a regression test, not a nicety.
- `detect_site` table tests over fixture listings, including the Laravel case where `artisan` must beat `package.json`.
- `vhost::render` sanitization: `foo bar`, `../evil`, `a/b`, unicode, empty, and a 200-character name. Never emits a path fragment or a second server block.
- Slug collision resolution is deterministic.
- DNS content render per platform, plus hosts-block marker round-trip: add, update, remove, and a block the user hand-edited or truncated.
- Authorization: a docroot outside its space root is rejected; a symlinked docroot is canonicalized before it reaches the YAML; an assertion that the string checked is byte-identical to the string emitted.
- `spec.rs` rejects an out-of-enum PHP version, an unknown service name and an out-of-range port.

## Phases

Ordered so that each phase ships something usable and the privileged work lands last, after the stack already works on plain ports.

1. Runtime probe, Settings tab shell, runtime status card. No containers. Proves the zero-cost gating and the lazy import.
2. Pure core with full tests: catalog, spec validation, compose renderer, Dockerfile renderer, site detection, vhost renderer. No UI wiring.
3. Up, down and status for data services only: MariaDB, PostgreSQL, Redis, Mailpit. `localhost:3306` works and the feature is already useful.
4. nginx plus PHP-FPM with site mounting, served at `localhost:<port>`. Still no DNS.
5. DNS: Unix wildcard first, then the Windows hosts block.
6. Logs drawer, statusbar pill, preview-tab integration.

## Success criteria

- With the feature untouched, Terra's startup does no Docker probe and the eager bundle grows by less than 2 kB.
- With the stack stopped, Terra's own RAM and CPU are unchanged from today.
- A fresh Laravel project in a Terra space is reachable at `<slug>.test` after enabling nginx, PHP and MariaDB, with no file edited by hand.
- Quitting and relaunching Terra leaves the stack running and the UI reporting it accurately.
- The `.test` setup prompts for elevation exactly once on Linux and macOS.
- Every invariant in the Testing section has a test that fails when the invariant is broken.
