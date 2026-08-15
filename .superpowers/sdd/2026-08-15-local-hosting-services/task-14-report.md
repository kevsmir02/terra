# Task 14 Report: Sites table

## What I implemented

- Added the exact `slugFromName` and `nextSitePort` helpers, including the reserved port set.
- Added `SitesTable` with one row per site, URL, type badge, editable document root, guarded Open button, and the Windows slow-mount warning.
- Added the cross-window preview bridge required by the controller ruling:
  - Rust `open_preview_tab` command emits `terra:open-preview` to the main window.
  - The command is registered in `generate_handler!`.
  - Main-window `App.tsx` listens for the event and calls the existing `openPreviewTab` callback.
  - Settings invokes `open_preview_tab` when Open is clicked.

## SiteRow derivation

`ServicesSection` loads spaces into the settings-window `useSpaces` store when needed, then derives rows from those spaces. Each row gets its slug from `slugFromName(space.name)` and its current root from `space.root ?? ""`. `sites_detect` runs for each non-empty root; failed or empty-root detection uses a static, non-confident fallback.

Stored `services.sites` entries are indexed by slug. Existing ports and document-root overrides are retained. New ports are assigned with `nextSitePort` after the already assigned ports, and the resulting current site list is persisted through `setServicesConfig`. Detection supplies the current `kind` and `confident` values. On Windows, local spaces get `slowMount: true`; WSL spaces do not.

The Open button is enabled only when the nginx service reports healthy. Its URL is relayed with `invoke("open_preview_tab", { url })` rather than trying to use the main-window tab hook from the settings window.

## TDD Evidence

- RED: `pnpm test src/modules/services/lib/sites.test.ts` failed with `Cannot find package '@/modules/services/lib/sites'` before the helper implementation existed.
- GREEN: The same command passed after implementation: 1 test file, 4 tests passed.

## Verification runs

- `pnpm test src/modules/services/lib/sites.test.ts`: passed, 4 tests.
- `pnpm test`: passed, 80 test files and 1187 tests.
- `pnpm lint`: passed, Biome checked 351 files with no fixes.
- `pnpm check-types`: passed.
- `pnpm knip`: passed with the repository's existing 9 configuration hints only.
- `pnpm test src/app/eager-budget.test.ts`: passed, 2 tests.
- `docker start terra-build && docker exec terra-build bash -lc 'cd /work/src-tauri && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked services::'`: passed; clippy completed cleanly and 47 services tests passed.
- `pnpm tauri dev` and the Laravel/manual preview loop were skipped because this environment has no display or host Tauri build, as instructed.

## Files changed

- `src/modules/services/lib/sites.ts`
- `src/modules/services/lib/sites.test.ts`
- `src/modules/services/SitesTable.tsx`
- `src/modules/services/index.ts`
- `src/settings/sections/ServicesSection.tsx`
- `src-tauri/src/lib.rs`
- `src/app/App.tsx`

## Self-review findings

- The required brief steps and cross-window ruling are implemented.
- Site assignments are stable through the persisted `services.sites` array and keyed by slug.
- The eager-budget test remains green because the services section is already lazy-loaded and the new table stays in that section's chunk.
- No new blocking diagnostics were found. The diagnostics cache still reports existing App-level complexity, fan-out, and debug-statement findings outside this task.

## Issues or concerns

- Manual Tauri and Laravel verification could not run in the headless environment. The controller should validate that flow at the phase gate.
- Duplicate space names produce the same slug because the task explicitly derives slugs directly from the space name. The existing persisted site format is also slug-keyed, so resolving duplicate-name identity would require a broader schema decision.

## Fix round 1

### What changed

- `src/modules/services/lib/sites.ts:19-29`: added pure `uniqueSlug(name, taken)` helper with the `site` fallback for empty slugs and deterministic numeric suffixes.
- `src/modules/services/lib/sites.test.ts:25-39`: added coverage for unused base slugs, `-2`/`-3` collision suffixes, and empty-slug fallback deduplication.
- `src/modules/services/index.ts:13`: re-exported `uniqueSlug` for the settings section.
- `src/settings/sections/ServicesSection.tsx:95-98`: tracks a `used` slug set across `spaces.map`, while leaving the existing `taken` port logic unchanged.

### Covering tests

- `pnpm test src/modules/services/lib/sites.test.ts`: passed, 1 test file and 7 tests.
- `pnpm test`: passed, 80 test files and 1190 tests.
- `pnpm lint && pnpm check-types && pnpm knip`: passed; Biome checked 351 files with no fixes, TypeScript completed successfully, and Knip completed with the repository's existing 9 configuration hints.
- `pnpm test src/app/eager-budget.test.ts`: passed, 1 test file and 2 tests.

### Commit

- `fix(services): dedupe site slugs for same-named spaces`
