# Design: Hybrid Diagnostics & Lazy-Loaded LSP

**Date:** 2026-07-23
**Status:** Approved (brainstorming complete, pending implementation plan)

## Goal

Provide a flexible, high-performance diagnostics & Intellisense architecture for **Terra**.
By default, the editor provides zero-RAM, lightweight syntax checking and linting on save (Option 2). Users or teammates who desire full VS Code Intellisense (hover tooltips, go-to-definition `F12`, auto-imports, full language-server diagnostics) can opt-in to Language Server Protocol (LSP) via Settings (Option 3). When enabled, LSP operates on a **strict lazy-loading lifecycle**, spawning language servers only while supported file tabs are open and terminating them immediately upon tab closure.

## Decisions (from brainstorming)

1. **Option 2 as Default:** CodeMirror 6's `@codemirror/lint` (`lintGutter`) and `diagnosticsReporter` are active by default for all files. They report errors and warnings per active file to `diagnosticsStore` with 0 MB background RAM overhead.
2. **Opt-In LSP via Master Settings Toggle:** A master toggle **"Enable Language Server Protocol (LSP)"** is added to **Settings -> Editor**. Individual per-language LSP servers (e.g. Rust, TypeScript/JavaScript, Python, Go) can be configured via `<LspServersGroup />`.
3. **Strict Lazy LSP Lifecycle:** LSP language servers stay 100% OFF when the master toggle is disabled or when no active tabs consume that language server. When a supported file tab opens, `acquireDocExtension` initializes the server; when the last tab for that language closes, `handle.release()` terminates the background LSP process.
4. **Statusbar Diagnostics Indicator:** A lightweight diagnostics badge (`🔴 2 errors, ⚠️ 1 warning`) is displayed in `StatusBar.tsx` for the active editor tab, reading from `useDiagnosticsStore`.

## Architecture & Boundary

### Existing Modules Utilized

**Frontend (`src/modules/editor/` & `src/modules/lsp/`):**
- `src/modules/editor/lib/diagnosticsReporter.ts` — CodeMirror update listener reporting diagnostic counts to `useDiagnosticsStore`.
- `src/modules/editor/lib/diagnosticsStore.ts` — Zustand store tracking error/warning counts per file path.
- `src/modules/lsp/lib/useLspExtension.ts` — React hook attaching LSP extension to CodeMirror when LSP is enabled.
- `src/modules/lsp/lib/sessionManager.ts` — Manages document acquisition & reference counting for active LSP sessions.
- `src/settings/sections/EditorSection.tsx` & `src/settings/components/LspServersGroup.tsx` — Settings UI for LSP configuration.

**Backend (`src-tauri/src/modules/lsp/`):**
- `session.rs` — Manages child LSP processes (`rust-analyzer`, `vtsls`, `gopls`, `pyright`), JSON-RPC framing, and process termination when client disconnects.

### Modifications / Enhancements Needed

1. **Settings Store (`src/modules/settings/store.ts`):**
   - Add `lspMasterEnabled: boolean` (default: `false` for zero-overhead out of the box).
2. **Settings UI (`src/settings/sections/EditorSection.tsx`):**
   - Add Master LSP Toggle switch bound to `lspMasterEnabled`.
   - Show `<LspServersGroup />` conditionally or gated by master switch.
3. **Hook Extension (`src/modules/lsp/lib/useLspExtension.ts`):**
   - Check `lspMasterEnabled` in addition to per-language activation before acquiring doc handle.
4. **StatusBar (`src/modules/statusbar/StatusBar.tsx`):**
   - Render active tab diagnostics summary (`errors`, `warnings`) from `useDiagnosticsStore`.

## Data Flow & Lifecycle

```
[ Active File Tab ] ---> [ CodeMirror 6 Editor ]
                             |
       +---------------------+---------------------+
       |                                           |
       v                                           v
[ Option 2: Default Lint ]                [ Option 3: Opt-In LSP ]
  - @codemirror/lint                        - Settings -> Editor -> Master LSP Toggle
  - diagnosticsReporter.ts                  - useLspExtension(path, langId)
  - Updates useDiagnosticsStore             - Spawns Rust LSP process via acquireDocExtension()
  - 0 MB RAM penalty                        - Auto-kills LSP process via handle.release() on tab close
       |                                           |
       +---------------------+---------------------+
                             |
                             v
               [ Statusbar Diagnostics Badge ]
               "🔴 2 errors, ⚠️ 1 warning"
```

## Testing & Verification

1. `pnpm check-types` — TypeScript passes cleanly.
2. `pnpm lint` — Biome linter passes cleanly.
3. `pnpm test` — Vitest unit tests pass cleanly.
4. `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings` — Rust compilation & clippy pass cleanly.
5. `pnpm tauri dev` — App launches cleanly, default state has 0 LSP background processes, enabling LSP in Settings spawns language server lazily on file open and terminates on tab close.
