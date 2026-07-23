# Design: Hybrid Diagnostics & Lazy-Loaded LSP

**Date:** 2026-07-23
**Status:** Superseded by Existing Implementation (Audited & Verified)

## Summary & Audit Findings

During implementation auditing, it was verified that the hybrid diagnostics & lazy-loaded LSP architecture is **already fully shipped** in the codebase:

1. **Option 2 (Default On-Save Diagnostics & Statusbar Badge):**
   - `src/modules/editor/lib/diagnosticsReporter.ts` already wires CodeMirror 6's `@codemirror/lint` (`lintGutter`) and reports errors/warnings per file.
   - `src/modules/statusbar/DiagnosticsBadge.tsx` already renders active file error/warning counts (`🔴 2 errors, ⚠️ 1 warning`) reading from `useDiagnosticsStore`.
   - Zero background RAM overhead out of the box.

2. **Option 3 (Lazy-Loaded LSP Lifecycle):**
   - `src/modules/lsp/lib/sessionManager.ts` & `useLspExtension.ts` already implement reference-counted document acquiring (`acquireDocExtension`) and graceful idle session shutdown (`IDLE_SHUTDOWN_MS`).
   - Sessions auto-terminate when no active tabs consume that language server, preventing process thrashing while freeing RAM.
   - Per-language LSP activation (`lspActivation`) has zero `"enabled"` entries by default, satisfying zero-RAM out-of-the-box goals.

3. **Master Toggle (Decision 2 - Dropped as YAGNI):**
   - A global master toggle was evaluated and dropped as YAGNI because per-language activation already defaults to disabled, and hiding per-language configuration behind a master switch would introduce UX friction.

## Conclusion

No further code changes are required for this subsystem. The codebase already delivers fast, zero-overhead diagnostics by default alongside opt-in, ref-counted lazy LSP management.
