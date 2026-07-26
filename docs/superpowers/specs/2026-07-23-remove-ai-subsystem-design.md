# Design: Remove the AI Subsystem from Terra

**Date:** 2026-07-23
**Status:** Approved (brainstorming complete, pending implementation plan)

## Goal

Transform Terra from an AI-native terminal emulator into a clean, lightweight,
AI-free Terminal IDE. The built-in AI side-panel, agent loop, provider system,
and AI-specific IPC are obsolete because external CLI agent harnesses (Claude
Code, Codex, Gemini CLI, Pi) will run directly inside the terminal PTY. The
target outcome is a stripped-down, high-performance developer workspace focusing
on terminal emulation, code editing, file navigation, and source control.

## Decisions (from brainstorming)

1. **Terminal agent notifications: KEEP.** The `agents` module serves both the
   built-in AI agent (`localAgent`, `managedAgentsStore`) and terminal
   coding-agent notifications (OSC 777 detection, tab status badges,
   NotificationBell, hook installation for Claude Code/Codex/Gemini/Pi). Only
   the built-in AI parts are removed; terminal agent notifications stay because
   external CLI agents running in the PTY are the replacement paradigm.

2. **Rust AI backend: remove all AI-only commands.** Delete `net.rs` (AI HTTP
   proxy + LM ping), `shell/` (shell_run_command + shell_session + shell_bg),
   and `secrets.rs` (keychain for AI API keys). Remove their command
   registrations, state structs, and Cargo dependencies.

3. **Approach: frontend-first staged removal (4 stages).** Each stage leaves
   the app compilable and runnable. Frontend-first makes Rust AI commands
   provably dead code before removing them.

## Architecture & Boundary

### Remove (built-in AI only)

**Frontend:**
- `src/modules/ai/` — entire module (agent loop, providers, sessions, composer,
  tools, sub-agents, chat store, snippets, todos, autocomplete provider, plan
  store, keyring, native bridge)
- `src/components/ai-elements/` — Vercel AI Elements registry components
- `src/modules/editor/lib/autocomplete/` — AI inline completion (ghost text)
- `ai-diff` tab kind from the tab tagged union
- AI shortcuts (`ai.toggle`, `ai.toggleMini`, `ai.askSelection`,
  `editor.aiComplete`), command-palette commands (`toggleAi`, `askAiSelection`),
  settings sections (ModelsSection, AgentsSection), statusbar AI indicator
- `@ai-elements` registry from `components.json`

**Rust:**
- `src-tauri/src/modules/net.rs` — AI HTTP proxy + LM ping
- `src-tauri/src/modules/shell/` — entire directory (one-shot shell, persistent
  agent shell, background processes)
- `src-tauri/src/modules/secrets.rs` — OS keychain for AI API keys

**Dependencies (npm):** `@ai-sdk/anthropic`, `@ai-sdk/cerebras`, `@ai-sdk/google`,
`@ai-sdk/groq`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, `@ai-sdk/react`,
`@ai-sdk/xai`, `ai`, `use-stick-to-bottom`, `zod`

**Dependencies (Cargo):** `reqwest`, `bytes`, `futures-util`, `tokio`,
`keyring` (macOS + Windows)

### Keep (terminal agent notifications)

- `src/modules/agents/` — surgically stripped: remove `localAgent` state,
  `managedAgentsStore`, `maybeTriggerManagedReview`, `onActivateLocal`/
  `newAgentTab` wiring. Keep `sessions` (terminal agent tracking),
  `notifications`, `NotificationBell` (minus localAgent row),
  `AgentNotificationsBridge` (minus review trigger), hook enable/disable for
  Claude/Codex/Gemini/Pi
- Rust `pty/agent_detect.rs` — OSC 777 terminal agent detection (zero cost when
  no agent runs)
- Rust `modules/agent.rs` — `agent_enable_hooks`/`agent_hooks_status` for
  terminal coding-agent hook installation

### Keep (shared dependencies with non-AI consumers)

- `streamdown` (npm) — shared with `src/modules/markdown/MarkdownPreviewPane.tsx`
- `shared_child` (Cargo) — used by `lsp/session.rs`, `lsp/env.rs`,
  `git/process.rs`
- `tempfile` (Cargo) — used by `fs/file.rs` production code + many tests
- `objc2`/`objc2-foundation` (Cargo, macOS) — used by `main.rs` for
  NSUserDefaults
- `libc` (Cargo, Unix) — used by pty

### Keep (untouched core modules)

terminal, editor (minus autocomplete), explorer, source-control, git-history,
lsp, markdown, preview, spaces, theme, settings (minus AI sections), shortcuts
(minus AI), command-palette (minus AI), sidebar, header, statusbar (minus AI),
updater, workspace, tabs (minus ai-diff).

## Critical Implementation Detail: `native` IPC Bridge

The `native` object (`src/modules/ai/lib/native.ts`) is a central IPC bridge
used by **38 callers** across the entire app, not just AI. It wraps all IPC
calls (`workspace_*`, `fs_*`, `git_*`, `shell_*`) with `currentWorkspaceEnv()`.
It cannot be deleted with the AI module. It must be **relocated** to a neutral
location (`src/lib/native.ts`) and trimmed of AI-only methods
(`runCommand`, `shellSession*`, `shellBg*`), and all ~38 import sites updated
from `@/modules/ai/lib/native` to `@/lib/native`.

## Stage 1: AI Frontend Module Removal

### 1a. Extract `native` IPC bridge

- Move `src/modules/ai/lib/native.ts` to `src/lib/native.ts`
- Remove AI-only methods: `runCommand`, `shellSessionOpen`, `shellSessionRun`,
  `shellSessionClose`, `shellBgSpawn`, `shellBgLogs`, `shellBgKill`,
  `shellBgList`
- Keep: `workspaceCurrentDir`, `workspaceAuthorize`, all `readFile`/
  `writeFile`/`canonicalize`/`createFile`/`createDir`/`readDir`/`grep`/`glob`,
  all `git*` methods
- Update all import sites: `@/modules/ai/lib/native` to `@/lib/native`
- Also remove the AI-only TypeScript types from the moved file
  (`CommandOutput`, shell session types, etc.)

### 1b. Delete AI frontend module + ai-elements

- Delete `src/modules/ai/` entirely (after `native.ts` is extracted)
- Delete `src/components/ai-elements/` entirely
- Delete `src/modules/editor/lib/autocomplete/` (AI inline completion)

### 1c. Surgical edits in `App.tsx`

**Remove imports:** `AgentRunBridge`, `AiMiniWindow`,
`LocalAgentNotificationsBridge`, `SelectionAskAi`, `useAiBootstrap`,
`useAiLiveBridge`, `useChatStore`, `useSelectionAskAi` from `@/modules/ai`;
`AiComposerProvider` from `@/modules/ai/lib/composer`; `native` from
`@/modules/ai/lib/native` (replaced by `@/lib/native`)

**Keep imports:** `AgentNotificationsBridge`, `nextAttentionTarget` from
`@/modules/agents`

**Remove state/hooks:** `miniOpen`, `miniPresence`, `openMini`, `toggleMini`,
`focusInput`, `openPanel`, `panelOpen`, `setLive`, `respondToApproval`,
`attachSelection` (all from `useChatStore`); `hasComposer`, `keysLoaded` (from
`useAiBootstrap`); `togglePanelAndFocus`, `handleAttachFileToAgent`,
`askFromSelection`, `useSelectionAskAi`, `askPresence`

**Remove from `useTabs` destructuring:** `newAgentTab`, `openAiDiffTab`,
`closeAiDiffTab`

**Remove JSX:** `onActivateLocalAgent`, `useAiLiveBridge(...)` call,
`AgentRunBridge`, `LocalAgentNotificationsBridge`, `AiMiniWindow`,
`SelectionAskAi`, `AiComposerProvider` wrapper (return `shell` directly)

**Remove props passed to child components:** `onAttachToAgent` on
`FileExplorer`, `onAiDiffAccept`/`onAiDiffReject` on `WorkspaceSurface`,
`hasComposer`/`panelOpen`/`keysLoaded`/`onConnect` on `WorkspaceInputBar`,
`onOpenMini`/`onOpenAi`/`hasComposer` on `StatusBar`, `onActivateLocalAgent`
on `Header`

**Replace `native.workspaceAuthorize(cwd)` in `handleTerminalCwd`** with import
from `@/lib/native`

**Remove shortcuts:** `ai.toggle`, `ai.toggleMini`, `ai.askSelection`,
`editor.aiComplete` from the `shortcutHandlers` memo and `shortcutsDisabled`
function

**Keep shortcuts:** `editor.codeComplete` (native CodeMirror completion),
`agent.focusAttention` (terminal agent)

### 1d. Editor surgery

- `EditorPane.tsx`: remove imports from `@/modules/ai/config`
  (`endpointIdFromCompatModel`), `@/modules/ai/lib/keyring`
  (`getCustomEndpointKey`, `getKey`), `./lib/autocomplete/inlineExtension`
  (`inlineCompletion`, `triggerInlineCompletion`); remove `triggerAiComplete`
  from `EditorPaneHandle` type; remove `inlineCompletion` extension from the
  CodeMirror state; keep `triggerCodeComplete` (calls `startCompletion` from
  `@codemirror/autocomplete`)
- `useEditorFileSync.ts`: remove `ai-diff` tab reload logic (the
  `appliedDiffsRef` effect that checks `t.kind === "ai-diff"`)

### 1e. Tab union surgery

- Remove `ai-diff` kind from the tab tagged union in `src/modules/tabs/`
- Remove all `ai-diff` handling: tab creation (`openAiDiffTab`/
  `closeAiDiffTab`), rendering in `WorkspaceSurface`, status fields
  (`approvalId`, `status`), any diff-related components

### Verification gate

`pnpm check-types` passes, `pnpm lint` passes, `pnpm test` passes (AI test
files deleted), `pnpm tauri dev` launches without missing-module crashes.

## Stage 2: Shared Module Cleanup

### 2a. Shortcuts registry (`src/modules/shortcuts/shortcuts.ts`)

- Remove from `ShortcutId` type: `ai.toggle`, `ai.toggleMini`,
  `ai.askSelection`, `editor.aiComplete`
- Remove from `ShortcutGroup` type: `"AI"`
- Remove from `SHORTCUTS` array: the 4 AI shortcut entries
- Remove `"AI"` from `SHORTCUT_GROUPS`
- Reassign `agent.focusAttention` group from `"AI"` to `"Terminal"`
- Relabel `terminal.toggleInput` from "Toggle Shell / AI input" to "Toggle
  Shell input"

### 2b. Settings store (`src/modules/settings/store.ts`)

Remove from `Preferences` type and all corresponding KEY constants, defaults,
setters, and store read/write functions:
- `defaultModelId`, `customInstructions`
- `autocompleteEnabled`, `autocompleteTrigger`, `autocompleteProvider`,
  `autocompleteModelId`
- `lmstudioBaseURL`, `lmstudioModelId`, `mlxBaseURL`, `mlxModelId`,
  `ollamaBaseURL`, `ollamaModelId`
- `openaiCompatibleBaseURL`, `openaiCompatibleModelId`,
  `openaiCompatibleContextLimit`, `customEndpoints`, `openrouterModelId`
- `sttProvider`, `groqSttModel`, `whispercppBaseURL`
- `favoriteModelIds`, `recentModelIds`

Keep all non-AI prefs (theme, editor, terminal, explorer, LSP, autostart,
shortcuts, agentNotifications, workspace, background, etc.).

### 2c. Settings window (`src/settings/`)

- Delete `sections/ModelsSection.tsx` (providers, keys, models, autocomplete,
  STT)
- Delete `sections/AgentsSection.tsx` (AI sub-agents + snippets config)
- Delete `components/ProviderIcon.tsx` and `components/ProviderKeyCard.tsx`
- Edit `SettingsApp.tsx`: remove ModelsSection + AgentsSection imports and tab
  entries (`{ id: "models", ... }` and `{ id: "agents", ... }`)
- Edit `GeneralSection.tsx`: remove `customInstructions` setting row if present
- Remove `openSettingsWindow("models")` calls (already disconnected in Stage 1)

### 2d. Command palette (`src/modules/command-palette/commands.ts`)

- Remove `toggleAi` and `askAiSelection` from the params type and
  `createCommandItems`

### 2e. Statusbar (`src/modules/statusbar/`)

- Remove AI tools indicator
- Remove `onOpenMini`, `onOpenAi`, `hasComposer` props from the StatusBar
  component

### 2f. Agents module surgery (`src/modules/agents/`)

- `store/agentStore.ts`: remove `localAgent` state + `setLocalAgent` action.
  Keep `sessions`, `notifications`, `start`, `setStatus`, `finish`,
  `pushNotification`, `markAllRead`, `clearNotifications`,
  `nextAttentionTarget`
- Delete `store/managedAgentsStore.ts` entirely
- Delete `lib/review.ts` (`maybeTriggerManagedReview`)
- `components/AgentNotificationsBridge.tsx`: remove `maybeTriggerManagedReview`
  import/call, remove `useManagedAgentsStore` import/usage. Keep terminal agent
  signal handling (`handleSignal`, `route`, the `terra:agent-signal` listener)
- `components/NotificationBell.tsx`: remove `localAgent` state usage,
  `onActivateLocal` prop, localAgent `StatusRow`, `activateLocal` function.
  Keep terminal sessions, notifications, hook enable/disable for
  Claude/Codex/Gemini/Pi (`HOOK_AGENTS`, `HookAgentRow`, `enableHooks`)
- `lib/types.ts`: remove `LocalAgentState` type. Keep `AgentSession`,
  `AgentNotification`, `AgentSignal`, `AgentStatus`
- `index.ts`: remove managed-agent and localAgent exports. Keep
  `AgentNotificationsBridge`, `nextAttentionTarget`, `NotificationBell`

### 2g. Header (`src/modules/header/`)

- Remove `onActivateLocalAgent` prop
- Keep `onActivateAgent` prop

### 2h. WorkspaceInputBar (`src/app/components/WorkspaceInputBar.tsx`)

- Remove `hasComposer`, `panelOpen`, `keysLoaded`, `onConnect` props
- Keep block shell input functionality

### 2i. FileExplorer (`src/modules/explorer/`)

- Remove `onAttachToAgent` prop

### Verification gate

`pnpm check-types`, `pnpm lint`, `pnpm test` all pass. `pnpm tauri dev`
launches with no AI-related UI, no missing IPC crashes, terminal agent
notifications still functional.

## Stage 3: Rust Backend Removal

### Delete files

- `src-tauri/src/modules/net.rs` (AI HTTP proxy + LM ping)
- `src-tauri/src/modules/secrets.rs` (keychain for AI API keys)
- `src-tauri/src/modules/shell/` entire directory (`mod.rs`, `session.rs`,
  `background.rs`)

### Edit `src-tauri/src/modules/mod.rs`

Remove: `pub mod net;`, `pub mod secrets;`, `pub mod shell;`
Keep: `pub mod agent;`, `fs`, `git`, `history`, `lsp`, `proc`, `pty`,
`workspace`

### Edit `src-tauri/src/lib.rs`

- Line 3 `use` statement: remove `net`, `secrets`, `shell`
- Remove `.manage(shell::ShellState::default())`
- Remove `.manage(secrets::SecretsState::default())`
- Remove 8 `shell::*` command registrations
- Remove 4 `secrets::*` command registrations (`secrets_get`, `secrets_set`,
  `secrets_delete`, `secrets_get_all`)
- Remove 3 `net::*` command registrations (`lm_ping`, `ai_http_request`,
  `ai_http_stream`)
- Keep: `agent::agent_enable_hooks`, `agent::agent_hooks_status`

### Edit `src-tauri/Cargo.toml`

Remove from `[dependencies]`: `reqwest`, `bytes`, `futures-util`, `tokio` (all
only used by `net.rs`)

Remove `keyring` from both:
- `[target.'cfg(target_os = "macos")'.dependencies]`
- `[target.'cfg(target_os = "windows")'.dependencies]`

Keep: `shared_child` (lsp, git), `tempfile` (fs), `objc2`/`objc2-foundation`
(main.rs), `libc` (pty), `notify`, `which`, all grep/ignore/globset/nucleo
deps, all tauri-plugin deps

### Capabilities (`default.json`)

No changes needed. Custom `#[tauri::command]` handlers do not require
capability entries; only plugin permissions are listed there.

### Verification gate

`cd src-tauri && cargo clippy --all-targets --locked -- -D warnings` passes,
`cargo test --locked` passes, no broken module references.

## Stage 4: Dependency Cleanup, Docs & Verification

### 4a. npm dependency removal (`package.json`)

Remove from dependencies: `@ai-sdk/anthropic`, `@ai-sdk/cerebras`,
`@ai-sdk/google`, `@ai-sdk/groq`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`,
`@ai-sdk/react`, `@ai-sdk/xai`, `ai`, `use-stick-to-bottom`, `zod`

Keep `streamdown` (shared with markdown preview module).

Run `pnpm install` to update lockfile.

### 4b. Config file cleanup

- `components.json`: Remove `@ai-elements` registry entry
- `knip.json`: Verify/update if it references AI paths
- `vite.config.ts`: Verify no AI-specific aliases (the
  `vscode-languageserver-protocol` shim is for LSP, keep it)
- `.size-limit.json`: Update bundle limits if AI-related

### 4c. Documentation updates

- `TERRA.md`: Remove "AI subsystem" section, AI references in two-process model
  (`net::*`, `shell::*`, `secrets::*`), `AiComposerProvider` note in PTY shell
  integration, AI parts of agents module description, AI quality bar references.
  Update description from "AI-native terminal emulator" to "terminal IDE"
- Delete `docs/architecture/ai-subsystem.md`
- `docs/README.md`: Remove AI guide reference
- `docs/architecture/two-process-model.md`: Remove AI command catalog entries
- `docs/architecture/security-model.md`: Remove AI tool surface references
- `README.md`: Update branding from "AI-native" to "terminal IDE"
- `ROADMAP.md`: Remove AI-related roadmap items
- `CONTRIBUTING.md`: Remove AI provider contribution guidelines
- `Cargo.toml`: Update `description` field
- `package.json`: Update description if present

### 4d. Full verification (quality gates)

- `pnpm check-types` — TypeScript passes
- `pnpm lint` — Biome lint passes
- `pnpm test` — Vitest passes (AI tests deleted)
- `pnpm knip` — No unused exports/files
- `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings` — Rust
  passes
- `cd src-tauri && cargo test --locked` — Rust tests pass
- `pnpm tauri dev` — App launches cleanly, zero console errors, no missing IPC
  crashes
- Manual verify: terminal agent notifications work (OSC 777 detection for
  Claude Code/Codex/Gemini/Pi), terminal/editor/explorer/source-control/LSP all
  functional

## Testing Strategy

- Each stage has a verification gate (type-check, lint, test, clippy) that must
  pass before proceeding to the next
- AI test files are deleted with their modules (`config.test.ts`,
  `prompt.test.ts`, `compact.test.ts`, `errors.test.ts`, `edit.test.ts`,
  `search.test.ts`, shell session sentinel tests, run_blocking tests, etc.)
- Non-AI tests must continue passing untouched (terminal, editor, explorer, git,
  shortcuts, etc.)
- Rust tests for `shell/` are deleted with the module; Rust tests for `fs/`,
  `git/`, `lsp/`, `pty/` must continue passing
- No new test coverage is required (this is a removal, not a feature addition)
- The `LazyStore` for settings ignores unknown keys, so persisted AI preference
  keys from previous runs cause no issues

## Risk Analysis

1. **`native` IPC bridge extraction (highest risk)** — 38 callers import from
   `@/modules/ai/lib/native`. *Mitigation:* Move the file first, update all
   imports mechanically, verify `pnpm check-types` before deleting the AI
   module.

2. **Agents module surgery** — removing `localAgent`/`managedAgentsStore` while
   keeping terminal agent notifications. *Mitigation:* Careful surgical edits,
   verify terminal agent signals still fire.

3. **Dangling references** — AI module exports consumed by non-AI modules
   (e.g., `endpointIdFromCompatModel` in EditorPane.tsx). *Mitigation:*
   `pnpm check-types` after each sub-step catches these immediately.

4. **Rust dependency removal** — removing a Cargo dep that is transitively
   used. *Mitigation:* Verified `shared_child` (lsp/git), `tempfile` (fs),
   `objc2` (main.rs) all have non-AI consumers. `cargo clippy --all-targets`
   catches any mistake.

5. **Settings store migration** — removing preference keys. *Mitigation:*
   `LazyStore` ignores unknown keys; no migration needed.

## Files Affected (Summary)

**Deleted (frontend):** `src/modules/ai/` (~40 files), `src/components/ai-elements/`,
`src/modules/editor/lib/autocomplete/`, `src/settings/sections/ModelsSection.tsx`,
`src/settings/sections/AgentsSection.tsx`, `src/settings/components/ProviderIcon.tsx`,
`src/settings/components/ProviderKeyCard.tsx`, `src/modules/agents/store/managedAgentsStore.ts`,
`src/modules/agents/lib/review.ts`

**Deleted (Rust):** `src-tauri/src/modules/net.rs`,
`src-tauri/src/modules/secrets.rs`, `src-tauri/src/modules/shell/` (3 files)

**Deleted (docs):** `docs/architecture/ai-subsystem.md`

**Moved:** `src/modules/ai/lib/native.ts` to `src/lib/native.ts`

**Surgically edited:** `src/app/App.tsx`, `src/modules/editor/EditorPane.tsx`,
`src/modules/editor/useEditorFileSync.ts`, `src/modules/tabs/` (tab union),
`src/modules/shortcuts/shortcuts.ts`, `src/modules/settings/store.ts`,
`src/settings/SettingsApp.tsx`, `src/modules/command-palette/commands.ts`,
`src/modules/statusbar/`, `src/modules/agents/` (4 files),
`src/modules/header/`, `src/app/components/WorkspaceInputBar.tsx`,
`src/modules/explorer/`, `src-tauri/src/lib.rs`, `src-tauri/src/modules/mod.rs`,
`src-tauri/Cargo.toml`, `package.json`, `components.json`, `TERRA.md`,
`README.md`, `ROADMAP.md`, `CONTRIBUTING.md`, `docs/README.md`,
`docs/architecture/two-process-model.md`, `docs/architecture/security-model.md`
