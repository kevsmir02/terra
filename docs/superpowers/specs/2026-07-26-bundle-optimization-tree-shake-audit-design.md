# Bundle Optimization: Tree-Shake Audit — Design

**Roadmap item:** `ROADMAP.md` → Longer horizon → *"Bundle optimization: tree-shake audit. Language packs and heavy panes are already lazy-loaded."*

**Goal:** Make the startup-bundle budget measure what the browser actually loads, enforce it in CI, and spend the resulting honest number on the eager-graph leaks it exposes.

**Theme alignment:** *Lightweight always* — "7-8 MB binary. Every dependency justified. Per-tab memory budget enforced."

---

## Problem

The audit tooling already exists — `rollup-plugin-visualizer` (`ANALYZE=true`), `size-limit`, `knip`, `scripts/eager-graph.mjs`, and `src/app/eager-budget.test.ts`. The `manualChunks` config in `vite.config.ts` carries comments from a prior audit (issue #551). This is not greenfield work.

The problem is that **the budget under-reports by 43%, and nothing enforces it.**

### The budget measures the wrong thing

`.size-limit.json` defines the startup budget as five glob patterns:

```json
"path": [
  "dist/assets/main-*.js", "dist/assets/react-*.js", "dist/assets/radix-*.js",
  "dist/assets/alert-dialog-*.js", "dist/assets/xterm-*.js"
]
```

It reports **351 kB gzipped against a 540 kB limit** — a comfortable 65%.

The actual `modulepreload` set emitted into `dist/index.html` is **38 chunks totalling 500 kB gzipped** — **93% of the limit**. Real headroom is ~40 kB, not ~190 kB. `dist/settings.html` preloads a further 29 chunks at 197 kB gzipped, which the budget does not measure at all.

The five globs were correct when written. They rot silently every time chunking changes, because a hand-maintained list of hash-suffixed filenames cannot track a `manualChunks` function.

### Nothing enforces it

`.github/workflows/ci.yml` runs `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm build`. It does **not** run `knip` or `size-limit`. The only enforced gate is `src/app/eager-budget.test.ts`, which asserts that five *package names* stay out of the eager graph — it never checks weight, so 150 kB of drift passed it untouched.

### What the honest number exposes

Measured eager chunks that no first paint requires:

| Chunk | gzip | Root cause |
|---|---|---|
| `languageResolver-*.js` | 12.3 kB | `TabBar.tsx:23` imports `resolveDisplayName` (a name lookup) and drags in the full resolver plus its loader table |
| `updater-*.js` | 10.5 kB | `App.tsx:87` statically imports `UpdaterDialog`, which only renders when an update exists |
| `Tick02Icon-*.js` | 9.1 kB | hugeicons chunk pulled eagerly across 46 call sites |
| `lsp-*.js` | 8.1 kB | `App.tsx:38` imports the one-line `setLspNavigator` through the `@/modules/lsp` barrel |

Plus `knip` findings with real dependency weight: `@fontsource/jetbrains-mono`, `@radix-ui/react-use-controllable-state`, and devDependency `react-compiler-healthcheck` are unused. `knip` also reports `src/modules/lsp/lib/protocolShim.ts` as an unused file — a false positive, since it is reachable only through the `vscode-languageserver-protocol` alias in `vite.config.ts`.

---

## Goals

1. The startup budget measures the true eager set for **both** window entries and cannot drift out of sync with chunking.
2. Budget violations and `knip` regressions fail CI.
3. Reduce the measured eager set using the leaks the honest number exposes.

## Non-goals

- **The 48 unused exports and 40 unused exported types `knip` reports.** Rolldown already tree-shakes them; they cost approximately zero bundle bytes. ~88 deletions of diff churn belongs in a separate hygiene pass.
- **Subsetting `@iconify-json/catppuccin`.** Measured: the app uses 621 of 659 icons, so a subset saves 4.2% gzipped. Not worth the build step.
- **Moving the icon set off the eager graph.** See *Deferred decisions*.
- Rust binary size, install footprint, and CSS/font weight.

---

## Architecture

Three independent units. Each is separately testable and separately valuable.

### 1. `scripts/eager-size.mjs` — measure the true eager set

A static analyzer over build output, mirroring the existing `scripts/eager-graph.mjs` (library + CLI + `.d.mts` sidecar).

**Interface**

```js
/** @returns {{ entry: string, chunks: {file: string, gzip: number}[], totalGzip: number }[]} */
export function measureEager(distDir: string): EagerReport[]
```

**Behavior**

- For each of `dist/index.html` and `dist/settings.html`: parse the entry `<script type="module" src>` and every `<link rel="modulepreload" href>`.
- Deduplicate, gzip each referenced chunk on disk, and sum.
- The CLI prints a per-chunk table sorted descending plus a per-entry total, and exits non-zero when an entry exceeds its budget.

**Why parse the built HTML.** It is by construction exactly what the browser fetches before interaction. It stays correct across any `manualChunks` change, which is the precise failure the current globs suffered. The rejected alternative — expanding `.size-limit.json` to list all 38 chunks — reproduces the same rot. size-limit's `entry` mode was also rejected: it re-bundles independently of the Vite build, so it measures an artifact that never ships.

**Budgets** live in `eager-budget.json` at the repo root, keyed by entry HTML, expressed in gzipped kB. Initial values are set one ratchet step above measured (`index.html` 510 kB against 500 kB measured; `settings.html` 205 kB against 197 kB measured) so the gate starts green and tightens as cuts land.

### 2. CI enforcement

Two steps added to the `frontend` job in `.github/workflows/ci.yml`, after `pnpm build`:

- `pnpm size:eager` — new script, runs `node scripts/eager-size.mjs dist`.
- `pnpm knip` — fails on unused files, dependencies, and exports.

`knip.json` gains `src/modules/lsp/lib/protocolShim.ts` to `ignore`, with a comment recording that it is reached through the Vite alias. Without this, `knip` cannot be made green and therefore cannot be enforced.

`.size-limit.json` loses its misleading `"main window startup JS (eager modulepreload)"` entry, since `eager-size.mjs` now owns that measurement. The `"total client JS"` entry stays — it is glob-correct (`dist/assets/*.js`) and currently reports 1.16 MB against a 1.5 MB limit.

### 3. Eager-graph cuts

Four targeted changes, each independently verifiable by re-running `pnpm size:eager`:

- **`resolveDisplayName` split.** Extract the display-name lookup into a standalone module holding only the name map, so `TabBar` stops pulling the resolver's loader table. `resolveLanguage` / `resolveLanguageSync` stay where they are for editor consumers.
- **`UpdaterDialog` lazy.** Wrap in a `UpdaterDialogLazy.tsx` following the existing six-wrapper convention (`EditorStackLazy`, `DeviceDockLazy`, …). The dialog renders only when an update is available.
- **`setLspNavigator` by path.** `App.tsx` imports from `@/modules/lsp/lib/navigator` instead of the barrel, matching the precedent set by `PaneTreeView.tsx` importing `DevServerChip` by path to avoid the preview barrel.
- **hugeicons chunking.** Investigate why `Tick02Icon-*.js` reaches 9.1 kB gzipped and whether a `manualChunks` rule or per-icon import path keeps unused icons out of the eager set.

Any change that does not reduce measured gzip is reverted rather than kept on principle.

---

## Testing

- **`scripts/eager-size.test.ts`** — unit tests for `measureEager` against a fixture `dist` directory: multiple entries, deduplicated chunks shared between entries, and an entry whose total exceeds its budget.
- **`src/app/eager-budget.test.ts`** — unchanged. It guards package *identity*; `eager-size.mjs` guards *weight*. Both are needed: a 5 kB static import of `@codemirror` should fail on principle even when the budget has headroom.
- **Regression evidence** — each cut in unit 3 records before/after `pnpm size:eager` output in its commit message.

## Error handling

- `measureEager` throws with the offending path when an HTML entry is missing or a referenced chunk is absent from disk, rather than silently reporting a smaller total. A budget checker that under-reports on error would reproduce the bug this spec exists to fix.
- A missing `eager-budget.json` entry for a discovered HTML file is an error, not a skip — so adding a third window cannot silently escape the budget.

## Success criteria

1. `pnpm size:eager` reports both entries and fails when either exceeds budget.
2. CI fails on an artificial static import of a heavy module into `App.tsx`.
3. `pnpm knip` exits 0 and runs in CI.
4. Measured `index.html` eager total is reduced from the 500 kB gzipped baseline, with the budget ratcheted down to match.

---

## Deferred decisions

**The eager icon set (80 kB gzipped).** `iconResolver.ts:1` statically imports `@iconify-json/catppuccin/icons.json`, producing the third-heaviest eager chunk — larger than React. It is genuinely needed at first paint: `TabBar.tsx:24` calls `fileIconUrl` synchronously during render, as do six other modules.

Two options were evaluated and neither is taken now:

- *Ship as a fetched `.json` asset.* Saves ~22 kB gzipped by avoiding the escaped-JS-string inflation (292 kB raw as JSON versus 381 kB raw as embedded JS). Requires making `fileIconUrl` async across seven synchronous render call sites plus re-render plumbing, and risks icon pop-in on the tab bar. Poor trade at 22 kB.
- *Eager core set plus lazily hydrated full set.* Recovers up to ~78 kB gzipped but needs two icon sources, a hydration path, and a hand-maintained "common extensions" list.

Revisit only if the honest budget shows the eager set approaching its limit after unit 3 lands. The second option is where the remaining large win lives, and it should get its own spec.
