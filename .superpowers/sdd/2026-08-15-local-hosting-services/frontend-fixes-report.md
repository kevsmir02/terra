# Frontend fixes report

## Config schema

- What changed: Consolidated `ServicesConfig` in `src/modules/services/lib/config.ts:4` with stable site ids, workspace environments, and persisted runtime override. `src/modules/settings/store.ts:2` imports it as a type-only import, and defaults at `src/modules/settings/store.ts:265` now use `runtime: null`.
- Contract: The frontend configuration now produces the Rust stack fields without placing `runtime` inside `spec`.

## Stable site identity

- What changed: `src/settings/sections/ServicesSection.tsx:171` keys saved sites by `space.id`, carries `id` and `env` on every row, and persists the complete site shape at `src/settings/sections/ServicesSection.tsx:195`. Docroot updates also use the stable id at `src/settings/sections/ServicesSection.tsx:226`.
- Contract: Site detection at `src/settings/sections/ServicesSection.tsx:153` sends `{ root, env: space.env }` to `sites_detect`. Stored ports and docroots are looked up by id, while slugs remain derived mount paths.

## Runtime override and probing

- What changed: Added `RuntimeProbeAll` and `probeRuntimeAll` in `src/modules/services/lib/runtime.ts:13` and `src/modules/services/lib/runtime.ts:61`. `ServicesSection` probes both runtimes once on mount at `src/settings/sections/ServicesSection.tsx:109`, selects the effective override or automatic runtime, and renders the Auto, Docker, and Podman selector at `src/settings/sections/ServicesSection.tsx:348`. `RuntimeCard` is now presentational and receives status, busy, error, and refresh props.
- Contract: `services_runtime_probe_all` is invoked without arguments. Status selection prefers the configured runtime, otherwise Docker when ready, then Podman, then the more actionable failure state. `runtimeMessage` remains unchanged.

## Invoke contract and per-service controls

- What changed: `src/settings/sections/ServicesSection.tsx:259` passes `{ runtime }` to `services_status`; `src/settings/sections/ServicesSection.tsx:295` builds an explicit `{ services, ports, sites, dbPassword }` spec and passes `{ runtime, spec, targets: [id] }` to `services_up` or `services_down`; `src/settings/sections/ServicesSection.tsx:324` passes `{ runtime, volume }` to `services_delete_data`; and `src/modules/services/LogsDrawer.tsx:20` passes `{ runtime, service }` to `services_logs`. `src/modules/services/ServicesPill.tsx:60` also passes the persisted runtime to status polling.
- Contract: Runtime is always a top-level nullable override, targets contain only the toggled ServiceId, and runtime/state/registry parameters remain Rust-injected command state rather than frontend arguments.

## Connection details

- What changed: Added `connectionDetails` in `src/modules/services/lib/connection.ts:18` for MariaDB, PostgreSQL, and Redis, with null for Mailpit, Adminer, and Web. `src/modules/services/ServiceRow.tsx:67` renders an expandable details block for healthy running services with per-value copy buttons and a masked password reveal toggle while preserving existing open, toggle, and delete-data actions.
- Tests: `src/modules/services/lib/connection.test.ts:28` covers all three engines and web UI null cases.

## Services pill polling and count

- What changed: `src/settings/sections/ServicesSection.tsx:121` emits `terra:services-tab` on mount and unmount. `src/modules/services/ServicesPill.tsx:38` listens for that signal and polls only while focused and either the Services tab is open or the last observed status has a running service. The count at `src/modules/services/ServicesPill.tsx:79` counts `state === "running"`, including healthcheck-less services, and uses `bg-status-ok` when positive.

## Verification

- `pnpm test`: 81 files passed, 1195 tests passed.
- `pnpm lint`: passed.
- `pnpm check-types`: passed.
- `pnpm knip`: passed with the repository's existing 9 configuration hints only.
- `pnpm test src/app/eager-budget.test.ts`: 2 tests passed.
- `pnpm test src/app/eager-size.test.ts`: 7 tests passed.
- `git diff --check`: passed.

## Concerns

- `lens_diagnostics` reports one pre-existing warning in untouched `src-tauri/src/modules/services/catalog.rs:72` for an `expect()` call. No Rust files were changed.
- `pnpm format:check` reports existing formatting findings outside the changed files; all changed files were formatted directly and `pnpm lint` passed.
