# Bundle Optimization: Tree-Shake Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the startup-bundle budget measure what the browser actually loads, enforce it in CI, and spend the resulting honest number on the eager-graph leaks it exposes.

**Architecture:** A new `scripts/eager-size.mjs` parses the built `dist/*.html` for each window's entry script and `modulepreload` links, gzips those chunks, and checks the total against per-entry budgets in `eager-budget.json`. CI runs it after `pnpm build`, alongside `knip`. With an honest number in place, four targeted cuts remove modules from the eager graph, each verified by re-measuring.

**Tech Stack:** Node 22 ESM scripts, vitest, Vite 7 + Rolldown, size-limit, knip, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-07-26-bundle-optimization-tree-shake-audit-design.md`

## Global Constraints

- **No new dependencies.** Everything uses packages already in `package.json` and Node built-ins (`node:fs`, `node:zlib`, `node:path`, `node:url`).
- **Measured baseline (do not re-derive; verify against it):** `dist/index.html` = 38 chunks / **500 kB gzipped**; `dist/settings.html` = 29 chunks / **197 kB gzipped**.
- **Initial budgets are one ratchet step above measured** so the gate starts green: `index.html` 510 kB, `settings.html` 205 kB. Tasks 4-6 tighten them.
- **Budgets are gzipped kilobytes**, where 1 kB = 1024 bytes, computed with `zlib.gzipSync` at default level.
- **Any cut that does not reduce measured gzip is reverted**, not kept on principle. Tasks 4-6 each end with a measurement step that decides this.
- **Scripts follow the existing `scripts/eager-graph.mjs` convention:** an `.mjs` module exporting a pure function, a hand-written `.d.mts` sidecar for types, and a `const isCli = process.argv[1] === fileURLToPath(import.meta.url)` guard for CLI behavior.
- **Tests live under `src/`**, matching every existing test file. `src/app/eager-budget.test.ts` already imports from `../../scripts/`; follow that.
- Lint and types must stay clean: `pnpm lint && pnpm check-types`.
- **Out of scope:** the 48 unused exports and 40 unused exported types knip reports; icon-set subsetting; moving `@iconify-json/catppuccin` off the eager graph.

---

## File Structure

**Create**
- `scripts/eager-size.mjs` — parses built HTML entries, gzips referenced chunks, sums per entry. Pure `measureEager(distDir)` plus a CLI that checks budgets.
- `scripts/eager-size.d.mts` — type sidecar for the above.
- `eager-budget.json` — per-entry gzipped kB budgets, at repo root beside `.size-limit.json`.
- `src/app/eager-size.test.ts` — unit tests for `measureEager` against a temp fixture `dist`.
- `src/modules/updater/UpdaterDialogLazy.tsx` — `lazy()` wrapper following the `DeviceDockLazy` convention.

**Modify**
- `package.json` — add the `size:eager` script.
- `knip.json` — ignore `src/modules/lsp/lib/protocolShim.ts`; drop the three now-removed dependencies from `ignoreDependencies` if present.
- `.size-limit.json` — remove the misleading eager entry; keep `"total client JS"`.
- `.github/workflows/ci.yml` — add `size:eager` and `knip` steps to the `frontend` job.
- `src/modules/updater/index.ts` — export the lazy wrapper as `UpdaterDialog`.
- `src/app/App.tsx:38` — import `setLspNavigator` by path instead of through the barrel.

---

### Task 1: The eager-size measurement tool

Pure logic plus a CLI. Nothing else in the codebase changes, and nothing depends on it yet.

**Files:**
- Create: `scripts/eager-size.mjs`, `scripts/eager-size.d.mts`, `eager-budget.json`
- Test: `src/app/eager-size.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export function measureEager(distDir: string): EagerReport[]` where
    `EagerReport = { entry: string; chunks: { file: string; gzip: number }[]; totalGzip: number }`
  - `export function readBudgets(rootDir: string): Record<string, number>`
  - `chunks` is sorted by `gzip` descending; `totalGzip` is in bytes.

- [ ] **Step 1: Write the failing tests**

Create `src/app/eager-size.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { measureEager } from "../../scripts/eager-size.mjs";

let dir: string;

function html(entry: string, preloads: string[]): string {
  const links = preloads
    .map((p) => `<link rel="modulepreload" crossorigin href="/${p}">`)
    .join("\n");
  return `<!doctype html><html><head>${links}</head><body><script type="module" crossorigin src="/${entry}"></script></body></html>`;
}

function chunk(name: string, bytes: number): void {
  writeFileSync(join(dir, name), "x".repeat(bytes));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "eager-size-"));
  mkdirSync(join(dir, "assets"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("measureEager", () => {
  it("counts the entry script plus every modulepreload", () => {
    chunk("assets/main.js", 5000);
    chunk("assets/react.js", 3000);
    writeFileSync(
      join(dir, "index.html"),
      html("assets/main.js", ["assets/react.js"]),
    );

    const [report] = measureEager(dir);

    expect(report.entry).toBe("index.html");
    expect(report.chunks.map((c) => c.file)).toEqual([
      "assets/main.js",
      "assets/react.js",
    ]);
    expect(report.totalGzip).toBe(
      report.chunks[0].gzip + report.chunks[1].gzip,
    );
  });

  it("sorts chunks by gzipped size descending", () => {
    chunk("assets/small.js", 100);
    chunk("assets/big.js", 90000);
    writeFileSync(
      join(dir, "index.html"),
      html("assets/small.js", ["assets/big.js"]),
    );

    const [report] = measureEager(dir);

    expect(report.chunks[0].file).toBe("assets/big.js");
  });

  it("counts a chunk once when the entry also preloads it", () => {
    chunk("assets/main.js", 4000);
    writeFileSync(
      join(dir, "index.html"),
      html("assets/main.js", ["assets/main.js"]),
    );

    const [report] = measureEager(dir);

    expect(report.chunks).toHaveLength(1);
  });

  it("reports every html entry in the dist directory", () => {
    chunk("assets/main.js", 1000);
    chunk("assets/settings.js", 800);
    writeFileSync(join(dir, "index.html"), html("assets/main.js", []));
    writeFileSync(join(dir, "settings.html"), html("assets/settings.js", []));

    const entries = measureEager(dir).map((r) => r.entry);

    expect(entries).toEqual(["index.html", "settings.html"]);
  });

  it("ignores non-module scripts and stylesheet links", () => {
    chunk("assets/main.js", 2000);
    writeFileSync(
      join(dir, "index.html"),
      `<!doctype html><html><head>` +
        `<link rel="stylesheet" href="/assets/main.css">` +
        `</head><body><script>var inline = 1;</script>` +
        `<script type="module" crossorigin src="/assets/main.js"></script>` +
        `</body></html>`,
    );

    const [report] = measureEager(dir);

    expect(report.chunks.map((c) => c.file)).toEqual(["assets/main.js"]);
  });

  it("throws naming the chunk when a referenced file is missing", () => {
    writeFileSync(join(dir, "index.html"), html("assets/gone.js", []));

    expect(() => measureEager(dir)).toThrow(/assets\/gone\.js/);
  });

  it("throws when the dist directory has no html entry", () => {
    expect(() => measureEager(dir)).toThrow(/no html entr/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/app/eager-size.test.ts`
Expected: FAIL — `Failed to resolve import "../../scripts/eager-size.mjs"`.

- [ ] **Step 3: Write the implementation**

Create `scripts/eager-size.mjs`:

```js
#!/usr/bin/env node
// Measures each window's true startup cost: the entry module script plus every
// <link rel="modulepreload"> the build emits into that window's HTML. That set
// is by definition what the browser fetches before interaction, so it stays
// correct across any manualChunks change - unlike the hand-maintained,
// hash-suffixed globs it replaces, which silently under-reported by 43%.
//
// CLI:  node scripts/eager-size.mjs [distDir]
// Used as a library by src/app/eager-size.test.ts.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// `href`/`src` may appear before or after other attributes, so match the tag
// first and pull the URL out of it rather than assuming attribute order.
const PRELOAD_TAG = /<link\b[^>]*\brel="modulepreload"[^>]*>/gi;
const MODULE_SCRIPT_TAG = /<script\b[^>]*\btype="module"[^>]*>/gi;
const URL_ATTR = /\b(?:href|src)="([^"]+)"/i;

function urlsFrom(html, tagRe) {
  const out = [];
  for (const [tag] of html.matchAll(tagRe)) {
    const m = tag.match(URL_ATTR);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Strip the leading slash Vite emits so the path joins onto distDir. */
function toRelative(url) {
  return url.replace(/^\.?\//, "");
}

/**
 * @param {string} distDir
 * @returns {{entry: string, chunks: {file: string, gzip: number}[], totalGzip: number}[]}
 */
export function measureEager(distDir) {
  const dist = resolve(root, distDir);
  const entries = readdirSync(dist)
    .filter((f) => f.endsWith(".html"))
    .sort();
  if (entries.length === 0) {
    throw new Error(`eager-size: no html entries found in ${dist}`);
  }

  return entries.map((entry) => {
    const html = readFileSync(join(dist, entry), "utf8");
    const urls = [
      ...urlsFrom(html, MODULE_SCRIPT_TAG),
      ...urlsFrom(html, PRELOAD_TAG),
    ]
      .map(toRelative)
      .filter((f) => f.endsWith(".js"));

    const seen = new Set();
    const chunks = [];
    for (const file of urls) {
      if (seen.has(file)) continue;
      seen.add(file);
      const abs = join(dist, file);
      // Reporting a smaller total on a missing file would reproduce exactly the
      // under-measurement this script exists to prevent.
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        throw new Error(`eager-size: ${entry} references missing chunk ${file}`);
      }
      chunks.push({ file, gzip: gzipSync(readFileSync(abs)).length });
    }
    chunks.sort((a, b) => b.gzip - a.gzip);

    return {
      entry,
      chunks,
      totalGzip: chunks.reduce((sum, c) => sum + c.gzip, 0),
    };
  });
}

/** @returns {Record<string, number>} entry html name -> budget in gzipped kB */
export function readBudgets(rootDir = root) {
  return JSON.parse(readFileSync(join(rootDir, "eager-budget.json"), "utf8"));
}

const KB = 1024;

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  const reports = measureEager(process.argv[2] || "dist");
  const budgets = readBudgets();
  let failed = false;

  for (const { entry, chunks, totalGzip } of reports) {
    const budget = budgets[entry];
    console.log(`\n${entry} - eager startup chunks`);
    for (const c of chunks) {
      console.log(`  ${String((c.gzip / KB).toFixed(1)).padStart(8)} kB  ${c.file}`);
    }
    const total = totalGzip / KB;
    // A new window entry with no budget must fail, not silently escape the gate.
    if (budget === undefined) {
      console.error(`  MISSING BUDGET for ${entry} - add it to eager-budget.json`);
      failed = true;
      continue;
    }
    const verdict = total > budget ? "OVER BUDGET" : "ok";
    console.log(
      `  ---\n  ${total.toFixed(1)} kB gzipped across ${chunks.length} chunks (budget ${budget} kB) ${verdict}`,
    );
    if (total > budget) failed = true;
  }

  console.log("");
  process.exit(failed ? 1 : 0);
}
```

- [ ] **Step 4: Write the type sidecar**

Create `scripts/eager-size.d.mts`:

```ts
export function measureEager(distDir: string): {
  entry: string;
  chunks: { file: string; gzip: number }[];
  totalGzip: number;
}[];

export function readBudgets(rootDir?: string): Record<string, number>;
```

- [ ] **Step 5: Create the budget file**

Create `eager-budget.json`:

```json
{
  "index.html": 510,
  "settings.html": 205
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run src/app/eager-size.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 7: Verify against the real build**

Run: `pnpm build && node scripts/eager-size.mjs dist`

Expected: exit code 0, with `index.html` reporting ≈500 kB across 38 chunks and `settings.html` ≈197 kB across 29 chunks. The largest `index.html` rows should be `xterm` (~130 kB), `main` (~93 kB), `esm` (~78 kB), `react` (~64 kB), `radix` (~54 kB).

If the totals differ from the baseline by more than a few kB, stop and reconcile before continuing — the rest of the plan ratchets against these numbers.

- [ ] **Step 8: Verify types and lint**

Run: `pnpm check-types && pnpm lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add scripts/eager-size.mjs scripts/eager-size.d.mts eager-budget.json src/app/eager-size.test.ts
git commit -m "feat(build): measure the true eager startup set from built HTML"
```

---

### Task 2: Make knip green

`knip` exits 1 today for two unrelated reasons: a false-positive unused file
and three genuinely unused packages. Both must be fixed before Task 3 can
enforce it in CI — enforcing a gate that cannot pass is not enforcement.

**Files:**
- Modify: `knip.json`, `package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Consumes: nothing.
- Produces: `pnpm knip` exits 0.

- [ ] **Step 1: Confirm the current failures**

Run: `pnpm knip`

Expected: exit 1, reporting `Unused files (1)` naming
`src/modules/lsp/lib/protocolShim.ts`, `Unused dependencies (2)` naming
`@fontsource/jetbrains-mono` and `@radix-ui/react-use-controllable-state`, and
`Unused devDependencies (1)` naming `react-compiler-healthcheck`.

If the report differs, reconcile before continuing — the rest of this task
assumes those exact findings.

- [ ] **Step 2: Silence the false positive**

`protocolShim.ts` is reachable only through the `vscode-languageserver-protocol`
alias in `vite.config.ts`, which knip does not resolve. It is live code — the
alias comment records that it keeps a ~117 kB CJS package out of the bundle —
so it must be ignored, not deleted.

In `knip.json`, change:

```json
  "ignore": ["src/components/ui/**"],
```

to:

```json
  "ignore": [
    "src/components/ui/**",
    "src/modules/lsp/lib/protocolShim.ts"
  ],
```

- [ ] **Step 3: Confirm the three packages are genuinely unreferenced**

Run:

```bash
grep -rn "jetbrains-mono\|react-use-controllable-state\|react-compiler-healthcheck" src scripts vite.config.ts package.json
grep -rn "jetbrains" src/styles src/lib/fonts.ts
```

Expected: hits **only** in `package.json`, and nothing from the second command.

If a stylesheet `@import`s the font or references it by family name, it is
loaded some other way — leave that package installed, add it to
`ignoreDependencies` with a comment, and note the deviation.

- [ ] **Step 4: Remove them**

```bash
pnpm remove @fontsource/jetbrains-mono @radix-ui/react-use-controllable-state react-compiler-healthcheck
```

- [ ] **Step 5: Verify knip is clean and nothing broke**

Run: `pnpm knip && pnpm check-types && pnpm lint && pnpm test && pnpm build`

Expected: all pass, with `pnpm knip` exiting 0 and reporting no unused files,
dependencies, or devDependencies.

Knip may now emit configuration hints suggesting entries be dropped from
`ignoreDependencies`. Act only on hints naming the three packages just removed;
leave the rest alone.

- [ ] **Step 6: Confirm the fonts still render**

Run `pnpm tauri dev`, open a terminal pane and the editor, and confirm the
monospace font is unchanged. `@fontsource-variable/inter` and the terminal font
stack are untouched by this task, so any visible change means Step 3 missed a
reference — revert and investigate.

- [ ] **Step 7: Commit**

```bash
git add knip.json package.json pnpm-lock.yaml
git commit -m "chore(deps): drop unused packages and teach knip about the protocol shim"
```

---

### Task 3: Enforce the budget and knip in CI

**Files:**
- Modify: `package.json` (scripts), `.size-limit.json`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `scripts/eager-size.mjs` CLI from Task 1; a green `pnpm knip` from Task 2.
- Produces: `pnpm size:eager`; CI failure on budget or knip regression.

- [ ] **Step 1: Add the script**

In `package.json`, add to `"scripts"` immediately after the existing `"analyze:eager"` line:

```json
    "size:eager": "node scripts/eager-size.mjs dist",
```

- [ ] **Step 2: Remove the misleading size-limit entry**

`scripts/eager-size.mjs` now owns the eager measurement, and the old entry
reports a number 43% below reality. In `.size-limit.json`, delete the first
object so the file reads exactly:

```json
[
  {
    "name": "total client JS",
    "path": ["dist/assets/*.js"],
    "limit": "1500 KB",
    "gzip": true
  }
]
```

- [ ] **Step 3: Verify all gates pass locally**

Run: `pnpm build && pnpm size:eager && pnpm knip && pnpm size`

Expected: all four succeed. If `pnpm knip` still reports unused files or
dependencies, do **not** widen the ignore list to force it green — Task 2 was
left incomplete; finish it first.

- [ ] **Step 4: Add the CI steps**

In `.github/workflows/ci.yml`, in the `frontend` job, replace:

```yaml
      - name: Build frontend
        run: pnpm build
```

with:

```yaml
      - name: Build frontend
        run: pnpm build

      - name: Startup bundle budget
        run: pnpm size:eager

      - name: Unused files, deps and exports
        run: pnpm knip
```

- [ ] **Step 5: Prove the over-budget gate fails**

Temporarily lower `index.html` in `eager-budget.json` to `10`, then run:

Run: `pnpm size:eager`
Expected: FAIL — `OVER BUDGET`, exit code 1.

Restore the value to `510` and re-run to confirm it passes again.

- [ ] **Step 6: Prove an unbudgeted window cannot slip through**

A new window entry with no budget must fail rather than be skipped, otherwise
adding a third window silently escapes the gate. Temporarily rename the
`"settings.html"` key in `eager-budget.json` to `"settings-old.html"`, then:

Run: `pnpm size:eager`
Expected: FAIL — `MISSING BUDGET for settings.html`, exit code 1.

Restore the key to `"settings.html"` and re-run to confirm it passes again.

- [ ] **Step 7: Commit**

```bash
git add package.json .size-limit.json .github/workflows/ci.yml
git commit -m "ci: enforce startup bundle budget and knip"
```

---

### Task 4: Lazy-load the updater dialog

`UpdaterDialog` renders only when an update is available, but `App.tsx:87`
imports it statically, putting `updater-*.js` (10.5 kB gzipped, including
`@tauri-apps/plugin-updater`) in the startup preload set.

**Files:**
- Create: `src/modules/updater/UpdaterDialogLazy.tsx`
- Modify: `src/modules/updater/index.ts`
- Test: measured via `pnpm size:eager`

**Interfaces:**
- Consumes: `scripts/eager-size.mjs` from Task 1.
- Produces: `UpdaterDialog` exported from `@/modules/updater` now resolves to the lazy wrapper. `App.tsx` is unchanged — its import site keeps working.

- [ ] **Step 1: Record the baseline**

Run: `pnpm build && pnpm size:eager`

Write down the `index.html` total and confirm `assets/updater-*.js` appears in
the chunk list at roughly 10.5 kB.

- [ ] **Step 2: Read the convention**

Read `src/modules/device/DeviceDockLazy.tsx`. Note that the guard which
prevents the chunk from loading lives in the **wrapper**, not the inner
component — React only requests a lazy chunk once the inner element renders.

- [ ] **Step 3: Write the wrapper**

Create `src/modules/updater/UpdaterDialogLazy.tsx`:

```tsx
import { lazy, Suspense } from "react";

const UpdaterDialogInner = lazy(() =>
  import("./UpdaterDialog").then((m) => ({ default: m.UpdaterDialog })),
);

/**
 * The updater dialog and its @tauri-apps/plugin-updater dependency are only
 * ever needed once an update exists, which is never on a cold start. Rendering
 * the inner element behind Suspense is what keeps that chunk out of the
 * startup preload set; a static import here would defeat the whole wrapper.
 */
export function UpdaterDialog() {
  return (
    <Suspense fallback={null}>
      <UpdaterDialogInner />
    </Suspense>
  );
}
```

- [ ] **Step 4: Point the barrel at the wrapper**

Change `src/modules/updater/index.ts` from:

```ts
export { UpdaterDialog } from "./UpdaterDialog";
export { useUpdater } from "./useUpdater";
```

to:

```ts
export { UpdaterDialog } from "./UpdaterDialogLazy";
export { useUpdater } from "./useUpdater";
```

`useUpdater` stays a direct export — `src/settings/sections/AboutSection.tsx`
imports it, and the settings window has its own budget line.

- [ ] **Step 5: Measure the result**

Run: `pnpm build && pnpm size:eager`

Expected: `assets/updater-*.js` no longer appears in the `index.html` chunk
list, and the total drops by roughly 10 kB.

**If the total did not drop, revert this task.** A remaining static path into
the module means the wrapper bought nothing; note the finding in the commit
message of a later task rather than keeping dead indirection.

- [ ] **Step 6: Verify the dialog still works**

Run: `pnpm check-types && pnpm lint && pnpm test`
Expected: all pass.

Then run `pnpm tauri dev` and open Settings → About → check for updates.
Confirm the updater UI still appears and reports a result. This path is the
only consumer of the lazy chunk, so it is the only way to catch a broken
`Suspense` boundary.

- [ ] **Step 7: Ratchet the budget**

In `eager-budget.json`, lower `"index.html"` to the new measured total rounded
up to the next whole kB, plus 5 kB of headroom.

Run: `pnpm size:eager`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/updater/UpdaterDialogLazy.tsx src/modules/updater/index.ts eager-budget.json
git commit -m "perf(updater): lazy-load the updater dialog out of the startup graph"
```

---

### Task 5: Import the LSP navigator by path

`App.tsx:38` imports the one-line `setLspNavigator` through the
`@/modules/lsp` barrel, which re-exports `LspStatusPill`, `detect`, `presets`,
`runtimeStore`, `sessionManager` and `useLspExtension`. This is the same barrel
leak that `PaneTreeView.tsx` already avoids by importing `DevServerChip` by
path.

**Files:**
- Modify: `src/app/App.tsx:38`
- Test: measured via `pnpm size:eager`

**Interfaces:**
- Consumes: `setLspNavigator` from `src/modules/lsp/lib/navigator.ts` (unchanged signature: `(nav: LspNavigator | null) => void`).
- Produces: no API change.

- [ ] **Step 1: Record the baseline**

Run: `pnpm build && pnpm size:eager`

Note the `index.html` total and the size of `assets/lsp-*.js` (~8.1 kB).

- [ ] **Step 2: Change the import**

In `src/app/App.tsx`, change line 38 from:

```tsx
import { setLspNavigator } from "@/modules/lsp";
```

to:

```tsx
import { setLspNavigator } from "@/modules/lsp/lib/navigator";
```

- [ ] **Step 3: Measure the result**

Run: `pnpm build && pnpm size:eager`

Expected: the `index.html` total drops. Note that `StatusBar.tsx:6` still
imports `LspStatusPill` from the barrel and the statusbar renders at first
paint, so `lsp-*.js` will **not** disappear entirely — only the modules the
navigator no longer drags in are removed. A drop of a few kB is a success; no
drop means the barrel was already being pulled by `StatusBar` alone.

**If the total did not drop, revert this task.** Importing by path is only
worth the inconsistency when it buys bytes.

- [ ] **Step 4: Verify go-to-definition still navigates**

Run: `pnpm check-types && pnpm lint && pnpm test`
Expected: all pass.

Then run `pnpm tauri dev`, open a file in a project with an enabled language
server, and press F12 on a symbol defined in another file. Confirm the editor
opens that file — this exercises `setLspNavigator`, whose registration is the
only thing this task moves.

- [ ] **Step 5: Ratchet the budget**

In `eager-budget.json`, lower `"index.html"` to the new measured total rounded
up to the next whole kB, plus 5 kB of headroom.

Run: `pnpm size:eager`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/App.tsx eager-budget.json
git commit -m "perf(lsp): import the navigator by path to avoid the module barrel"
```

---

### Task 6: Investigate the language-resolver and hugeicons chunks

Unlike Tasks 4 and 5, these two have no pre-verified fix. `TabBar.tsx` imports
`resolveDisplayName` from `languageResolver` **and** `ALL_LANGUAGES` /
`EXPOSED_LANGUAGES` from `languageDefinitions`, so removing one import alone
may not move anything. `languageResolver-*.js` is also a shared chunk — its
41 kB holds more than the 91-line source file — so the 12.3 kB is not all
attributable to `TabBar`.

This task is explicitly allowed to end in "no change, finding recorded".

**Files:**
- Modify (only if the measurement justifies it): `src/modules/editor/lib/languageResolver.ts`, `src/modules/editor/lib/languageDefinitions.ts`, `src/modules/tabs/TabBar.tsx`, `vite.config.ts`
- Test: `src/modules/editor/lib/languageResolver.test.ts` (existing, must keep passing)

**Interfaces:**
- Consumes: `measureEager` output from Task 1.
- Produces: either a measured reduction plus a ratcheted budget, or a documented finding and no code change.

- [ ] **Step 1: Record the baseline and identify the real occupants**

Run:

```bash
pnpm build && pnpm size:eager
node -e 'const s=require("fs").readFileSync(require("fs").readdirSync("dist/assets").filter(f=>f.startsWith("languageResolver-")).map(f=>"dist/assets/"+f)[0],"utf8");console.log("chars:",s.length);console.log("imports:",[...s.matchAll(/from"\.\/([\w-]+)\.js"/g)].map(m=>m[1]).join(", "))'
```

Record what the chunk actually contains. If the bulk is not language-resolution
code, the `TabBar` import is not the cause and Step 2 will not help — skip to
Step 4.

- [ ] **Step 2: Try splitting the display-name lookup**

Only attempt this if Step 1 showed language-resolution code dominating.

`resolveDisplayName` needs `filenameMap` and `extensionMap` from
`languageDefinitions`, which also holds the `LANGUAGES` table whose entries
carry dynamic-import loader closures. The loaders are already lazy boundaries,
so the eager cost is the table itself, not the language packs.

Extract the name-only data into a new `src/modules/editor/lib/languageNames.ts`
holding a plain `Record<string, string>` of extension/filename to display name,
generated by hand from `LANGUAGES`, then have `TabBar.tsx:23` import
`resolveDisplayName` from there.

Keep `resolveDisplayName` exported from `languageResolver.ts` as a re-export so
`src/modules/editor/lib/languageResolver.test.ts` keeps passing unchanged.

- [ ] **Step 3: Measure**

Run: `pnpm build && pnpm size:eager && pnpm test`

Expected: `index.html` total drops and all tests pass. **If the total did not
drop, revert Step 2 entirely** — a duplicated name table that buys nothing is
worse than the import it replaced.

- [ ] **Step 4: Investigate the hugeicons chunk**

Run:

```bash
node -e 'const fs=require("fs");const f=fs.readdirSync("dist/assets").find(x=>x.startsWith("Tick02Icon-"));const s=fs.readFileSync("dist/assets/"+f,"utf8");console.log(f,s.length,"chars");console.log("exported icon names:",(s.match(/var \w+Icon=/g)||[]).length)'
```

If the chunk exports many icons but only a few are used at startup, add a
`manualChunks` rule in `vite.config.ts` splitting `@hugeicons/core-free-icons`
per icon, mirroring the existing `cm-lang-*` rule:

```ts
          {
            const m = id.match(/@hugeicons\/core-free-icons\/.*?([\w]+Icon)/);
            if (m) return `hugeicon-${m[1]}`;
          }
```

Place it directly above the existing `@codemirror/lang-` block.

- [ ] **Step 5: Measure the icon change**

Run: `pnpm build && pnpm size:eager`

Expected: the `index.html` total drops. **If it rises** — many tiny chunks cost
more in per-chunk overhead than one shared chunk — **revert the `manualChunks`
addition.** Record the outcome either way.

- [ ] **Step 6: Verify the UI is intact**

Run: `pnpm check-types && pnpm lint && pnpm test`
Expected: all pass.

Then run `pnpm tauri dev` and confirm icons still render in the tab bar, the
sidebar rail, and the statusbar. A broken `manualChunks` glob shows up as
missing icons, not as a build error.

- [ ] **Step 7: Ratchet the budget if anything changed**

If either sub-investigation produced a reduction, lower `"index.html"` in
`eager-budget.json` to the new measured total plus 5 kB of headroom, and run
`pnpm size:eager` to confirm it passes.

If neither produced a reduction, leave the budget alone.

- [ ] **Step 8: Commit**

If code changed:

```bash
git add -A
git commit -m "perf(bundle): trim the eager language and icon chunks"
```

If nothing changed, commit only the finding so the next audit does not repeat
the work:

```bash
git commit --allow-empty -m "chore(bundle): record why the language and icon chunks resist splitting"
```

Put the measured numbers and the reason in the commit body either way.

---

### Task 7: Final verification and roadmap update

**Files:**
- Modify: `ROADMAP.md:104`

- [ ] **Step 1: Run every gate from a clean build**

```bash
rm -rf dist
pnpm install --frozen-lockfile
pnpm lint && pnpm check-types && pnpm test && pnpm build && pnpm size:eager && pnpm knip && pnpm size
```

Expected: all pass. Record the final `index.html` and `settings.html` totals.

- [ ] **Step 2: Confirm the gate still catches a regression**

Add a deliberate static import of a heavy lazy module to `src/app/App.tsx`:

```tsx
import { GitHistoryPane } from "@/modules/git-history/GitHistoryPane";
```

Run: `pnpm build && pnpm size:eager`
Expected: FAIL — `OVER BUDGET` on `index.html`.

Remove the import and re-run to confirm it passes. This is the end-to-end proof
that the budget does the job the old globs failed at.

- [ ] **Step 3: Update the roadmap**

In `ROADMAP.md`, remove line 104 from "Longer horizon":

```markdown
- [ ] Bundle optimization: tree-shake audit. Language packs and heavy panes are already lazy-loaded.
```

Add to the **Shipped** section under a new `### Build & Bundle` heading placed
immediately before `### Platform Integration`:

```markdown
### Build & Bundle

- [x] **Enforced Startup Bundle Budget**: Per-window eager-set measurement derived from the built HTML (entry script plus every `modulepreload`), gated in CI alongside `knip`. Replaces hand-maintained size-limit globs that under-reported the eager set by 43%.
```

Word the entry as a budget with cuts, not as a one-off optimization — the
enforcement is the durable part.

- [ ] **Step 4: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: move bundle optimization to shipped"
```

---

## Post-implementation

- The icon-set decision stays deferred. `docs/superpowers/specs/2026-07-26-bundle-optimization-tree-shake-audit-design.md` → *Deferred decisions* records both evaluated options with their measured costs. Revisit only if the ratcheted budget shows the eager set approaching its limit again.
- The 48 unused exports and 40 unused exported types knip reports remain out of scope and unenforced. `pnpm knip` passes today because those categories are reported without failing the run; if a future change makes knip fail on them, that is the signal to schedule the hygiene pass rather than to widen the ignore list.
