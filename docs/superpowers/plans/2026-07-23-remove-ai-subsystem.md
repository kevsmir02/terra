# Remove AI Subsystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the built-in AI subsystem from Terax, transforming it from an AI-native terminal emulator into a clean, AI-free Terminal IDE, while preserving terminal coding-agent notifications (OSC 777 detection for Claude Code/Codex/Gemini/Pi).

**Architecture:** Frontend-first staged removal across 4 stages. Each stage leaves the app compilable and runnable. The `native` IPC bridge (currently in the AI module but used app-wide) is extracted first. Terminal agent notifications are surgically preserved while built-in AI agent state is removed.

**Tech Stack:** Tauri 2 + Rust backend, React 19 + TypeScript + xterm.js frontend, pnpm package manager, Biome linter, Vitest test runner, Cargo/clippy for Rust.

## Global Constraints

- Package manager: **pnpm only**, never npm/npx/yarn
- Frontend checks: `pnpm lint`, `pnpm check-types`, `pnpm test`
- Rust checks: `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`, `cd src-tauri && cargo test --locked`
- Imports: always `@/...` on the frontend, never relative across modules
- No em-dash anywhere: code, comments, commits, docs
- No emojis anywhere
- No comments unless genuinely needed (1-2 lines on why, never what)
- Keep `streamdown` npm dep (shared with markdown preview)
- Keep `shared_child` Cargo dep (used by lsp, git)
- Keep terminal agent notifications (OSC 777 detection, tab badges, NotificationBell, hook installation)
- Path alias: `@/*` maps to `src/*`

---

## Stage 1: AI Frontend Module Removal

### Task 1: Extract `native` IPC bridge to `src/lib/native.ts`

**Files:**
- Create: `src/lib/native.ts`
- Delete: `src/modules/ai/lib/native.ts` (after all imports updated)
- Modify: all files importing from `@/modules/ai/lib/native`

**Interfaces:**
- Produces: `native` object at `@/lib/native` with workspace, fs, and git methods (no shell methods)

- [ ] **Step 1: Create `src/lib/native.ts` with the trimmed bridge**

Copy the content of `src/modules/ai/lib/native.ts` to `src/lib/native.ts`, but remove all shell-related methods and types. Keep: `workspaceCurrentDir`, `workspaceAuthorize`, `readFile`, `writeFile`, `canonicalize`, `createFile`, `createDir`, `readDir`, `grep`, `glob`, and all `git*` methods. Remove: `runCommand`, `shellSessionOpen`, `shellSessionRun`, `shellSessionClose`, `shellBgSpawn`, `shellBgLogs`, `shellBgKill`, `shellBgList`, and the `CommandOutput` type. Keep the `currentWorkspaceEnv` import from `@/modules/workspace`.

```typescript
import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";

// ... keep all type definitions EXCEPT CommandOutput and shell session types ...
// ... keep the `native` object but WITHOUT shell methods ...

export const native = {
  workspaceCurrentDir: () => invoke<string>("workspace_current_dir"),
  workspaceAuthorize: (path: string) =>
    invoke<string>("workspace_authorize", {
      path,
      workspace: currentWorkspaceEnv(),
    }),
  readFile: (path: string) =>
    invoke<ReadResult>("fs_read_file", {
      path,
      workspace: currentWorkspaceEnv(),
    }),
  // ... all other fs and git methods, verbatim from the original ...
  // DO NOT include: runCommand, shellSession*, shellBg*
};
```

- [ ] **Step 2: Update all import sites from `@/modules/ai/lib/native` to `@/lib/native`**

Run this command to find all files that need updating:

```bash
grep -rl "from \"@/modules/ai/lib/native\"" src/ --include="*.ts" --include="*.tsx"
```

For each file found, replace `from "@/modules/ai/lib/native"` with `from "@/lib/native"`. Files that are inside `src/modules/ai/` will be deleted in Task 2, so only update files OUTSIDE `src/modules/ai/`. Key files include:
- `src/app/App.tsx`
- `src/app/components/useGitBranch.ts`
- `src/app/hooks/useWorkspaceSwitcher.ts`
- `src/modules/source-control/` files
- `src/modules/git-history/` files
- `src/modules/explorer/` files
- `src/modules/agents/lib/review.ts` (will be deleted in Task 11, but update to avoid broken import before then)
- Any other files found by the grep

- [ ] **Step 3: Verify the new file compiles**

Run: `pnpm check-types`
Expected: PASS (the old `src/modules/ai/lib/native.ts` still exists, so AI module files still compile)

- [ ] **Step 4: Commit**

```bash
git add src/lib/native.ts
git add -u  # stages all modified import sites
git commit -m "refactor: extract native IPC bridge to src/lib/native.ts

Move the app-wide IPC bridge out of the AI module so the AI module
can be deleted. Trim shell methods (AI-only); keep workspace, fs,
and git methods."
```

---

### Task 2: Delete AI frontend module, ai-elements, and editor autocomplete

**Files:**
- Delete: `src/modules/ai/` (entire directory)
- Delete: `src/components/ai-elements/` (entire directory)
- Delete: `src/modules/editor/lib/autocomplete/` (entire directory)

**Interfaces:**
- Consumes: `src/lib/native.ts` from Task 1
- Produces: (nothing - these are removed)

- [ ] **Step 1: Delete the AI module directory**

```bash
rm -rf src/modules/ai/
```

- [ ] **Step 2: Delete the ai-elements components directory**

```bash
rm -rf src/components/ai-elements/
```

- [ ] **Step 3: Delete the editor autocomplete directory**

```bash
rm -rf src/modules/editor/lib/autocomplete/
```

- [ ] **Step 4: Verify what breaks**

Run: `pnpm check-types`
Expected: FAIL with errors in files that imported from `@/modules/ai`, `@/components/ai-elements`, or `@/modules/editor/lib/autocomplete`. These will be fixed in Tasks 3-5. Note the error list for reference.

- [ ] **Step 5: Commit (intermediate - will be fixed by subsequent tasks)**

```bash
git add -A
git commit -m "refactor: delete AI frontend module, ai-elements, and editor autocomplete

This breaks imports in App.tsx, EditorPane.tsx, and other shared
modules. Subsequent tasks fix the broken references."
```

---

### Task 3: Remove AI wiring from `App.tsx`

**Files:**
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: `src/lib/native.ts` from Task 1
- Produces: `App` component without AI dependencies

This is the largest surgical edit. The file is 1375 lines. Remove all AI imports, state, callbacks, JSX, and props. Keep terminal agent notification imports and wiring.

- [ ] **Step 1: Remove AI imports (lines 17-28)**

Remove these import lines:
```typescript
import {
  AgentRunBridge,
  AiMiniWindow,
  LocalAgentNotificationsBridge,
  SelectionAskAi,
  useAiBootstrap,
  useAiLiveBridge,
  useChatStore,
  useSelectionAskAi,
} from "@/modules/ai";
import { AiComposerProvider } from "@/modules/ai/lib/composer";
import { native } from "@/modules/ai/lib/native";
```

Keep the agents import (lines 13-16):
```typescript
import {
  AgentNotificationsBridge,
  nextAttentionTarget,
} from "@/modules/agents";
```

Add the new native import:
```typescript
import { native } from "@/lib/native";
```

- [ ] **Step 2: Remove AI tab functions from `useTabs` destructuring**

Remove from the destructuring (around line 123-132): `newAgentTab`, `openAiDiffTab`, `closeAiDiffTab`.

- [ ] **Step 3: Remove AI state hooks (lines 295-305)**

Remove:
```typescript
const miniOpen = useChatStore((s) => s.mini.open);
const miniPresence = usePresence(miniOpen, 200);
const openMini = useChatStore((s) => s.openMini);
const toggleMini = useChatStore((s) => s.toggleMini);
const focusInput = useChatStore((s) => s.focusInput);
const openPanel = useChatStore((s) => s.openPanel);
const panelOpen = useChatStore((s) => s.panelOpen);
const setLive = useChatStore((s) => s.setLive);
const respondToApproval = useChatStore((s) => s.respondToApproval);

const { hasComposer, keysLoaded } = useAiBootstrap();
```

- [ ] **Step 4: Remove AI callbacks (lines 440-497)**

Remove: `togglePanelAndFocus`, `attachSelection`, `handleAttachFileToAgent`, `askFromSelection`, `useSelectionAskAi`, `askPresence`.

- [ ] **Step 5: Remove AI shortcuts from `shortcutHandlers` memo (lines 738-746, 760-761)**

Remove these entries from the `shortcutHandlers` object:
```typescript
"ai.toggle": togglePanelAndFocus,
"ai.toggleMini": () => { ... },
"ai.askSelection": askFromSelection,
```

Remove:
```typescript
"editor.aiComplete": () =>
  editorRefs.current.get(activeId)?.triggerAiComplete(),
```

Keep `editor.codeComplete` and `agent.focusAttention`.

- [ ] **Step 6: Remove AI shortcut disabled-checks from `shortcutsDisabled` (lines 802-808, 809-818)**

Remove the `editor.aiComplete` check from the `editor.undo || editor.redo` block. Remove the entire `ai.askSelection` check block.

- [ ] **Step 7: Remove `onActivateLocalAgent` callback (lines 912-915)**

Remove:
```typescript
const onActivateLocalAgent = useCallback(() => {
  openPanel();
  focusInput(null);
}, [openPanel, focusInput]);
```

Keep `onActivateAgent` (line 910):
```typescript
const onActivateAgent = activateAgentTarget;
```

- [ ] **Step 8: Remove `useAiLiveBridge` call (lines 1141-1151)**

Remove the entire `useAiLiveBridge({ ... })` call.

- [ ] **Step 9: Remove AI props from child components in JSX**

In the `<Header>` element (around line 1158): remove `onActivateLocalAgent={onActivateLocalAgent}`. Keep `onActivateAgent={onActivateAgent}`.

In the `<FileExplorer>` element (around line 1212): remove `onAttachToAgent={handleAttachFileToAgent}`.

In the `<WorkspaceSurface>` element (around line 1247): remove `onAiDiffAccept={(id) => respondToApproval(id, true)}` and `onAiDiffReject={(id) => respondToApproval(id, false)}`.

In the `<WorkspaceInputBar>` element (around line 1269): remove `hasComposer={hasComposer}`, `panelOpen={panelOpen}`, `keysLoaded={keysLoaded}`, `onConnect={() => void openSettingsWindow("models")}`.

In the `<StatusBar>` element (around line 1286): remove `onOpenMini={openMini}`, `onOpenAi={togglePanelAndFocus}`, `hasComposer={hasComposer}`.

- [ ] **Step 10: Remove AI JSX blocks (lines 1308-1329)**

Remove:
```typescript
{hasComposer ? (
  <>
    <AgentRunBridge
      openAiDiffTab={openAiDiffTab}
      closeAiDiffTab={closeAiDiffTab}
    />
    <LocalAgentNotificationsBridge />
  </>
) : null}

{hasComposer && miniPresence.mounted ? (
  <AiMiniWindow state={miniPresence.state} />
) : null}
{askPresence.mounted ? (
  <SelectionAskAi ... />
) : null}
```

Keep:
```typescript
<AgentNotificationsBridge
  tabs={tabs}
  activeId={activeId}
  onActivate={onActivateAgent}
/>
```

- [ ] **Step 11: Remove `AiComposerProvider` wrapper (line 1374)**

Change:
```typescript
return <AiComposerProvider>{shell}</AiComposerProvider>;
```
To:
```typescript
return shell;
```

- [ ] **Step 12: Remove AI-related props from `commandPaletteItems` memo (lines 1079-1080)**

Remove `toggleAi: togglePanelAndFocus` and `askAiSelection: askFromSelection` from the `createCommandItems` call. Also remove from the dependency array: `togglePanelAndFocus`, `askFromSelection`.

- [ ] **Step 13: Verify `handleTerminalCwd` uses new native import**

The `handleTerminalCwd` callback (around line 892) calls `native.workspaceAuthorize(cwd)`. This now imports from `@/lib/native` (added in Step 1). Verify it compiles.

- [ ] **Step 14: Run type check**

Run: `pnpm check-types`
Expected: PASS (all AI references removed from App.tsx; remaining errors only in other files)

- [ ] **Step 15: Commit**

```bash
git add src/app/App.tsx
git commit -m "refactor: remove AI wiring from App.tsx

Remove AI imports, state, callbacks, shortcuts, JSX blocks, and
the AiComposerProvider wrapper. Keep terminal agent notification
wiring (AgentNotificationsBridge, nextAttentionTarget)."
```

---

### Task 4: Remove AI autocomplete from editor

**Files:**
- Modify: `src/modules/editor/EditorPane.tsx`
- Modify: `src/modules/editor/useEditorFileSync.ts`
- Modify: `src/modules/editor/index.ts` (if it re-exports autocomplete types)

**Interfaces:**
- Produces: `EditorPaneHandle` without `triggerAiComplete` method

- [ ] **Step 1: Remove AI imports from `EditorPane.tsx` (lines 1-2, 32-35)**

Remove:
```typescript
import { endpointIdFromCompatModel } from "@/modules/ai/config";
import { getCustomEndpointKey, getKey } from "@/modules/ai/lib/keyring";
```

Remove:
```typescript
import {
  inlineCompletion,
  triggerInlineCompletion,
} from "./lib/autocomplete/inlineExtension";
```

- [ ] **Step 2: Remove `triggerAiComplete` from `EditorPaneHandle` type**

Remove from the type (around line 79-80):
```typescript
/** Request an AI ghost suggestion at the cursor. */
triggerAiComplete: () => void;
```

Keep `triggerCodeComplete` (line 82):
```typescript
/** Open CodeMirror's completion popup. */
triggerCodeComplete: () => void;
```

- [ ] **Step 3: Remove `inlineCompletion` usage and `triggerAiComplete` implementation**

Find where `inlineCompletion` is used in the CodeMirror extensions array and remove it. Find the `triggerAiComplete` method on the handle object and remove it. Keep the `triggerCodeComplete` method (it calls `startCompletion` from `@codemirror/autocomplete`).

- [ ] **Step 4: Remove any autocomplete preference reads**

Remove any code that reads `autocompleteEnabled`, `autocompleteTrigger`, `autocompleteProvider`, `autocompleteModelId` from `usePreferencesStore`. Remove any autocomplete-related state or effects.

- [ ] **Step 5: Remove `ai-diff` reload logic from `useEditorFileSync.ts`**

Remove the `appliedDiffsRef` and the effect that checks `t.kind === "ai-diff"` (lines 28-41 of `useEditorFileSync.ts`):

```typescript
// Remove this entire block:
const appliedDiffsRef = useRef<Set<string>>(new Set());
useEffect(() => {
  for (const t of tabs) {
    if (t.kind !== "ai-diff") continue;
    if (t.status !== "approved") continue;
    if (appliedDiffsRef.current.has(t.approvalId)) continue;
    appliedDiffsRef.current.add(t.approvalId);
    for (const e of tabs) {
      if (e.kind !== "editor") continue;
      if (e.path !== t.path) continue;
      editorRefs.current.get(e.id)?.reload();
    }
  }
}, [tabs, editorRefs]);
```

Also update the JSDoc comment that references AI diffs (line 19: "Keeps open editor tabs in sync with on-disk changes: reloads on applied AI diffs, external writes, and fs-watch events"). Remove the "applied AI diffs" reference.

- [ ] **Step 6: Run type check**

Run: `pnpm check-types`
Expected: PASS (fewer errors than before; editor no longer references AI)

- [ ] **Step 7: Commit**

```bash
git add src/modules/editor/
git commit -m "refactor: remove AI autocomplete and ai-diff reload from editor

Remove inlineCompletion extension, triggerAiComplete handle method,
and AI config/keyring imports from EditorPane. Remove ai-diff tab
reload logic from useEditorFileSync."
```

---

### Task 5: Remove `ai-diff` tab kind from the tab union

**Files:**
- Modify: `src/modules/tabs/lib/useTabs.ts` (type definitions + tab functions)
- Modify: `src/modules/tabs/index.ts` (re-exports)
- Modify: `src/app/components/WorkspaceSurface.tsx` (ai-diff rendering)
- Modify: any file that pattern-matches on `t.kind === "ai-diff"`

**Interfaces:**
- Produces: `Tab` union type without `AiDiffTab`

- [ ] **Step 1: Find all references to `ai-diff` and `AiDiffTab`**

```bash
grep -rn "ai-diff\|AiDiffTab\|AiDiffStatus\|openAiDiffTab\|closeAiDiffTab" src/ --include="*.ts" --include="*.tsx"
```

- [ ] **Step 2: Remove `AiDiffTab` and `AiDiffStatus` types from `useTabs.ts`**

Remove (around lines 72-86):
```typescript
export type AiDiffStatus = "pending" | "approved" | "rejected";

export type AiDiffTab = TabBase & {
  id: number;
  kind: "ai-diff";
  title: string;
  path: string;
  originalContent: string;
  proposedContent: string;
  approvalId: string;
  status: AiDiffStatus;
  isNewFile: boolean;
};
```

Remove `AiDiffTab` from the `Tab` union (line 122):
```typescript
export type Tab =
  | TerminalTab
  | EditorTab
  | PreviewTab
  | MarkdownTab
  | GitDiffTab
  | GitHistoryTab
  | GitCommitFileDiffTab;
```

- [ ] **Step 3: Remove `openAiDiffTab` and `closeAiDiffTab` functions**

Remove the `openAiDiffTab` and `closeAiDiffTab` functions from `useTabs.ts` and from the return value. Remove any `ai-diff` handling in the `useTabs` hook (status updates, approvalId tracking).

- [ ] **Step 4: Remove `ai-diff` rendering from `WorkspaceSurface.tsx`**

Find and remove any JSX that renders `ai-diff` tabs (the diff view component that shows original/proposed content with accept/reject buttons). Remove `onAiDiffAccept`/`onAiDiffReject` props from the component.

- [ ] **Step 5: Remove `ai-diff` from tab serialization**

If `src/modules/spaces/lib/serialize.ts` handles `ai-diff` tab serialization, remove that case.

- [ ] **Step 6: Run type check**

Run: `pnpm check-types`
Expected: PASS (Stage 1 should now be complete - all AI frontend references gone)

- [ ] **Step 7: Run lint**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 8: Run tests**

Run: `pnpm test`
Expected: PASS (AI test files already deleted; non-AI tests pass)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: remove ai-diff tab kind from tab union

Remove AiDiffTab type, openAiDiffTab/closeAiDiffTab functions,
ai-diff rendering in WorkspaceSurface, and ai-diff serialization.
Stage 1 complete: AI frontend module fully removed."
```

---

## Stage 2: Shared Module Cleanup

### Task 6: Clean up shortcuts registry

**Files:**
- Modify: `src/modules/shortcuts/shortcuts.ts`

- [ ] **Step 1: Remove AI shortcut IDs from `ShortcutId` type**

Remove from the union (lines 42-44, 50):
```typescript
| "ai.toggle"
| "ai.toggleMini"
| "ai.askSelection"
```
And:
```typescript
| "editor.aiComplete"
```

- [ ] **Step 2: Remove `"AI"` from `ShortcutGroup` type (line 60)**

Remove:
```typescript
| "AI"
```

- [ ] **Step 3: Remove AI shortcut entries from `SHORTCUTS` array**

Remove the 4 entries: `ai.toggle` (lines 270-274), `ai.toggleMini` (lines 275-280), `ai.askSelection` (lines 281-286), `editor.aiComplete` (lines 361-365).

- [ ] **Step 4: Reassign `agent.focusAttention` group**

Change the `agent.focusAttention` entry (lines 287-292) group from `"AI"` to `"Terminal"`:
```typescript
{
  id: "agent.focusAttention",
  label: "Jump to agent needing attention",
  group: "Terminal",
  defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "a" }],
},
```

- [ ] **Step 5: Relabel `terminal.toggleInput`**

Change the label (line 201) from `"Toggle Shell / AI input"` to `"Toggle Shell input"`.

- [ ] **Step 6: Remove `"AI"` from `SHORTCUT_GROUPS` array (line 381)**

- [ ] **Step 7: Run type check and lint**

Run: `pnpm check-types && pnpm lint`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/modules/shortcuts/shortcuts.ts
git commit -m "refactor: remove AI shortcuts from registry

Remove ai.toggle, ai.toggleMini, ai.askSelection, editor.aiComplete.
Move agent.focusAttention to Terminal group. Relabel terminal.toggleInput."
```

---

### Task 7: Clean up settings store

**Files:**
- Modify: `src/modules/settings/store.ts`
- Modify: `src/modules/settings/preferences.ts` (if it re-exports AI prefs)

- [ ] **Step 1: Remove AI preference fields from `Preferences` type**

Remove these fields from the `Preferences` type (lines 121, 124, 127-145):
- `defaultModelId`
- `customInstructions`
- `autocompleteEnabled`, `autocompleteTrigger`, `autocompleteProvider`, `autocompleteModelId`
- `lmstudioBaseURL`, `lmstudioModelId`, `mlxBaseURL`, `mlxModelId`, `ollamaBaseURL`, `ollamaModelId`
- `openaiCompatibleBaseURL`, `openaiCompatibleModelId`, `openaiCompatibleContextLimit`
- `customEndpoints`, `openrouterModelId`
- `sttProvider`, `groqSttModel`, `whispercppBaseURL`
- `favoriteModelIds`, `recentModelIds`

Also remove the associated type aliases: `ModelId`, `AutocompleteTrigger`, `AutocompleteProviderId`, `SttProvider`, `CustomEndpoint` if they're only used by AI prefs.

- [ ] **Step 2: Remove AI KEY constants, defaults, and setter functions**

Remove all `KEY_AUTOCOMPLETE_*`, `KEY_LMSTUDIO_*`, `KEY_MLX_*`, `KEY_OLLAMA_*`, `KEY_OPENAI_COMPATIBLE_*`, `KEY_CUSTOM_ENDPOINTS`, `KEY_OPENROUTER_*`, `KEY_STT_*`, `KEY_WHISPERCPP_*`, `KEY_FAVORITE_MODELS`, `KEY_RECENT_MODELS`, `KEY_DEFAULT_MODEL`, `KEY_CUSTOM_INSTRUCTIONS` constants.

Remove all corresponding setter functions: `setAutocompleteEnabled`, `setAutocompleteTrigger`, `setAutocompleteProvider`, `setAutocompleteModelId`, `setLmstudioBaseURL`, `setLmstudioModelId`, `setMlxBaseURL`, `setMlxModelId`, `setOllamaBaseURL`, `setOllamaModelId`, `setOpenaiCompatibleBaseURL`, `setOpenaiCompatibleModelId`, `setOpenaiCompatibleContextLimit`, `setCustomEndpoints`, `setOpenrouterModelId`, `setSttProvider`, `setGroqSttModel`, `setWhispercppBaseURL`, `setFavoriteModelIds`, `setRecentModelIds`, `setDefaultModel`, `setCustomInstructions`, `emitKeysChanged`.

Remove AI fields from the `DEFAULTS` object.

- [ ] **Step 3: Remove AI prefs from the `loadPrefs` / `writePref` / migration logic**

Remove any AI preference loading, writing, or migration code.

- [ ] **Step 4: Run type check**

Run: `pnpm check-types`
Expected: FAIL with errors in files that reference removed AI settings (ModelsSection, AgentsSection, EditorPane autocomplete code - these are already deleted or will be fixed). Fix any remaining references.

- [ ] **Step 5: Commit**

```bash
git add src/modules/settings/store.ts src/modules/settings/preferences.ts
git commit -m "refactor: remove AI preference fields from settings store

Remove all AI-related preference fields, key constants, defaults,
and setter functions. Keep agentNotifications, terminal, editor,
theme, LSP, and all non-AI preferences."
```

---

### Task 8: Delete AI settings sections and update SettingsApp

**Files:**
- Delete: `src/settings/sections/ModelsSection.tsx`
- Delete: `src/settings/sections/AgentsSection.tsx`
- Delete: `src/settings/components/ProviderIcon.tsx`
- Delete: `src/settings/components/ProviderKeyCard.tsx`
- Modify: `src/settings/SettingsApp.tsx`

- [ ] **Step 1: Delete AI settings files**

```bash
rm src/settings/sections/ModelsSection.tsx
rm src/settings/sections/AgentsSection.tsx
rm src/settings/components/ProviderIcon.tsx
rm src/settings/components/ProviderKeyCard.tsx
```

- [ ] **Step 2: Remove ModelsSection and AgentsSection from `SettingsApp.tsx`**

Remove imports (lines 19, 22):
```typescript
import { AgentsSection } from "./sections/AgentsSection";
import { ModelsSection } from "./sections/ModelsSection";
```

Remove tab entries (lines 56, 61):
```typescript
{ id: "models", label: "Models", icon: AiScanIcon, component: ModelsSection },
{ id: "agents", label: "Agents", icon: ..., component: AgentsSection },
```

- [ ] **Step 3: Check `GeneralSection.tsx` for AI settings**

```bash
grep -n "customInstructions\|defaultModel\|autocomplete\|sttProvider\|whispercpp\|lmstudio\|ollama\|mlx\|openrouter\|openaiCompatible\|favoriteModel\|recentModel" src/settings/sections/GeneralSection.tsx
```

Remove any AI-related setting rows found.

- [ ] **Step 4: Run type check and lint**

Run: `pnpm check-types && pnpm lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete AI settings sections and provider components

Remove ModelsSection, AgentsSection, ProviderIcon, ProviderKeyCard.
Remove their tab entries from SettingsApp."
```

---

### Task 9: Clean up command palette and statusbar

**Files:**
- Modify: `src/modules/command-palette/commands.ts`
- Modify: `src/modules/statusbar/StatusBar.tsx` (or equivalent)

- [ ] **Step 1: Remove AI commands from command palette**

In `src/modules/command-palette/commands.ts`, remove `toggleAi` and `askAiSelection` from the params type and from the `createCommandItems` function body.

- [ ] **Step 2: Remove AI props from StatusBar**

In the StatusBar component, remove `onOpenMini`, `onOpenAi`, `hasComposer` from the props type and usage. Remove the AI tools indicator UI element.

- [ ] **Step 3: Run type check and lint**

Run: `pnpm check-types && pnpm lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/modules/command-palette/commands.ts src/modules/statusbar/
git commit -m "refactor: remove AI commands from palette and AI indicator from statusbar"
```

---

### Task 10: Agents module surgery - remove built-in AI, keep terminal agent notifications

**Files:**
- Delete: `src/modules/agents/store/managedAgentsStore.ts`
- Delete: `src/modules/agents/lib/review.ts`
- Modify: `src/modules/agents/store/agentStore.ts`
- Modify: `src/modules/agents/components/AgentNotificationsBridge.tsx`
- Modify: `src/modules/agents/components/NotificationBell.tsx`
- Modify: `src/modules/agents/lib/types.ts`

**Interfaces:**
- Produces: `useAgentStore` without `localAgent`/`setLocalAgent`; `AgentNotificationsBridge` without managed review; `NotificationBell` without `onActivateLocal`

- [ ] **Step 1: Delete `managedAgentsStore.ts` and `review.ts`**

```bash
rm src/modules/agents/store/managedAgentsStore.ts
rm src/modules/agents/lib/review.ts
```

- [ ] **Step 2: Remove `LocalAgentState` from `lib/types.ts`**

Remove (lines 41-44):
```typescript
export type LocalAgentState = {
  agent: string;
  status: AgentStatus;
} | null;
```

Keep all other types: `AgentStatus`, `AgentSource`, `AgentSignalKind`, `AgentSignal`, `AgentSession`, `AgentNotification`, `NotificationKind`.

- [ ] **Step 3: Remove `localAgent` from `agentStore.ts`**

Remove `LocalAgentState` from the import (line 6). Remove `localAgent` from `AgentStoreState` type (line 15) and `setLocalAgent` action (line 20). Remove `localAgent: null` from the initial state (line 30). Remove the `setLocalAgent` implementation (lines 78-86).

The resulting store keeps: `sessions`, `notifications`, `start`, `setStatus`, `finish`, `pushNotification`, `markAllRead`, `clearNotifications`, `nextAttentionTarget`.

- [ ] **Step 4: Remove managed review from `AgentNotificationsBridge.tsx`**

Remove imports (lines 6, 11):
```typescript
import { maybeTriggerManagedReview } from "../lib/review";
import { useManagedAgentsStore } from "../store/managedAgentsStore";
```

In `handleSignal`, remove `maybeTriggerManagedReview(leafId)` call (line 84) and `useManagedAgentsStore.getState().remove(leafId)` call (line 89).

The `finished` case becomes:
```typescript
case "finished": {
  store.setStatus(leafId, "waiting");
  const session = store.sessions[leafId];
  if (session) route(session, "finished", ctx);
  return;
}
```

The `exited` case becomes:
```typescript
case "exited":
  store.finish(leafId);
  return;
```

- [ ] **Step 5: Remove `localAgent` from `NotificationBell.tsx`**

Remove `onActivateLocal` from `Props` type (line 26):
```typescript
type Props = {
  onActivate: (tabId: number, leafId: number) => void;
};
```

Remove `localAgent` state read (line 181):
```typescript
const localAgent = useAgentStore((s) => s.localAgent);
```

Remove `activateLocal` function (lines 232-235). Remove `localAgent` from `activeCount` calculation (line 187): change to `const activeCount = active.length;`. Remove `localAgent` from `waitingCount` (line 190). Remove `activateLocal` from `activateNotification` (lines 237-240): change to:
```typescript
const activateNotification = (n: AgentNotification) => {
  activate(n.tabId, n.leafId);
};
```

Remove the `localAgent` StatusRow JSX (lines 300-306):
```typescript
{localAgent ? (
  <StatusRow
    agent={localAgent.agent}
    status={localAgent.status}
    onClick={activateLocal}
  />
) : null}
```

Update the empty state text (lines 294-296) from "Run the Terax agent or a coding agent to track it here." to "Run a coding agent to track it here."

- [ ] **Step 6: Verify `index.ts` exports are clean**

`src/modules/agents/index.ts` should still export:
```typescript
export { AgentNotificationsBridge } from "./components/AgentNotificationsBridge";
export { NotificationBell } from "./components/NotificationBell";
export { nextAttentionTarget } from "./store/agentStore";
```

No changes needed - it never exported managed agents store or review.

- [ ] **Step 7: Run type check, lint, and tests**

Run: `pnpm check-types && pnpm lint && pnpm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: remove built-in AI agent tracking from agents module

Delete managedAgentsStore and review trigger. Remove localAgent
state from agentStore. Strip localAgent and onActivateLocal from
NotificationBell. Remove managed review from AgentNotificationsBridge.
Keep terminal agent sessions, notifications, and hook management."
```

---

### Task 11: Clean up Header, WorkspaceInputBar, and FileExplorer props

**Files:**
- Modify: `src/modules/header/Header.tsx`
- Modify: `src/app/components/WorkspaceInputBar.tsx`
- Modify: `src/modules/explorer/FileExplorer.tsx` (or equivalent)

- [ ] **Step 1: Remove `onActivateLocalAgent` from Header**

In `src/modules/header/Header.tsx`, remove `onActivateLocalAgent` from the props type and from the `NotificationBell` usage. The `NotificationBell` now only takes `onActivate`.

- [ ] **Step 2: Remove AI props from WorkspaceInputBar**

In `src/app/components/WorkspaceInputBar.tsx`, remove `hasComposer`, `panelOpen`, `keysLoaded`, `onConnect` from the props type and any usage. Keep the block shell input functionality.

- [ ] **Step 3: Remove `onAttachToAgent` from FileExplorer**

In the FileExplorer component, remove `onAttachToAgent` from the props type and any usage (context menu "Attach to Agent" action).

- [ ] **Step 4: Run type check, lint, and tests**

Run: `pnpm check-types && pnpm lint && pnpm test`
Expected: PASS (Stage 2 complete)

- [ ] **Step 5: Commit**

```bash
git add src/modules/header/ src/app/components/WorkspaceInputBar.tsx src/modules/explorer/
git commit -m "refactor: remove AI props from Header, WorkspaceInputBar, FileExplorer

Remove onActivateLocalAgent from Header, hasComposer/panelOpen/
keysLoaded/onConnect from WorkspaceInputBar, onAttachToAgent from
FileExplorer. Stage 2 complete: shared modules cleaned up."
```

---

## Stage 3: Rust Backend Removal

### Task 12: Delete Rust AI modules and update mod.rs

**Files:**
- Delete: `src-tauri/src/modules/net.rs`
- Delete: `src-tauri/src/modules/secrets.rs`
- Delete: `src-tauri/src/modules/shell/` (entire directory)
- Modify: `src-tauri/src/modules/mod.rs`

- [ ] **Step 1: Delete AI Rust modules**

```bash
rm src-tauri/src/modules/net.rs
rm src-tauri/src/modules/secrets.rs
rm -rf src-tauri/src/modules/shell/
```

- [ ] **Step 2: Update `mod.rs`**

Edit `src-tauri/src/modules/mod.rs` to remove the deleted modules:

```rust
pub mod agent;
pub mod fs;
pub mod git;
pub mod history;
pub mod lsp;
pub mod proc;
pub mod pty;
pub mod workspace;
```

Remove: `pub mod net;`, `pub mod secrets;`, `pub mod shell;`

- [ ] **Step 3: Commit (will not compile yet - lib.rs still references deleted modules)**

```bash
git add -A
git commit -m "refactor: delete Rust AI modules (net, secrets, shell)

Delete net.rs (AI HTTP proxy), secrets.rs (keychain), shell/
(one-shot shell, persistent agent shell, background processes).
Update mod.rs to remove module declarations."
```

---

### Task 13: Update `lib.rs` command registrations

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Remove AI module imports from the `use` statement (line 3)**

Change:
```rust
use modules::{agent, fs, git, history, lsp, net, pty, secrets, shell, workspace};
```
To:
```rust
use modules::{agent, fs, git, history, lsp, pty, workspace};
```

- [ ] **Step 2: Remove AI state management (lines 223-224)**

Remove:
```rust
.manage(shell::ShellState::default())
.manage(secrets::SecretsState::default())
```

- [ ] **Step 3: Remove AI command registrations from `invoke_handler`**

Remove these lines from the `generate_handler!` macro:
```rust
shell::shell_run_command,
shell::shell_session_open,
shell::shell_session_run,
shell::shell_session_close,
shell::shell_bg_spawn,
shell::shell_bg_logs,
shell::shell_bg_kill,
shell::shell_bg_list,
```

Remove:
```rust
secrets::secrets_get,
secrets::secrets_set,
secrets::secrets_delete,
secrets::secrets_get_all,
```

Remove:
```rust
net::lm_ping,
net::ai_http_request,
net::ai_http_stream,
```

Keep:
```rust
agent::agent_enable_hooks,
agent::agent_hooks_status,
```

- [ ] **Step 4: Run clippy**

Run: `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`
Expected: FAIL if Cargo.toml still has unused deps (fixed in Task 14). May also pass if Cargo is lenient about unused deps. If it fails on unused deps, proceed to Task 14.

- [ ] **Step 5: Run tests**

Run: `cd src-tauri && cargo test --locked`
Expected: PASS (shell tests deleted with the module; fs/git/lsp/pty tests pass)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/modules/mod.rs
git commit -m "refactor: remove AI command registrations from lib.rs

Remove shell, secrets, and net command handlers and state from
the Tauri builder. Keep agent_enable_hooks and agent_hooks_status
for terminal coding-agent hook installation."
```

---

### Task 14: Remove AI-only Cargo dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Remove AI-only deps from `[dependencies]`**

Remove these lines from the `[dependencies]` section:
```toml
reqwest = { version = "0.12", default-features = false, features = [
	"rustls-tls",
	"stream",
] }
bytes = "1"
futures-util = "0.3"
tokio = { version = "1", default-features = false, features = ["rt"] }
```

- [ ] **Step 2: Remove `keyring` from macOS target deps**

Remove from `[target.'cfg(target_os = "macos")'.dependencies]`:
```toml
keyring = { version = "3.6", default-features = false, features = [
	"apple-native",
] }
```

Keep `objc2` and `objc2-foundation` (used by `main.rs`).

- [ ] **Step 3: Remove `keyring` from Windows target deps**

Remove from `[target.'cfg(target_os = "windows")'.dependencies]`:
```toml
keyring = { version = "3.6", default-features = false, features = [
	"windows-native",
] }
```

Keep `windows-sys` (used by pty job objects).

- [ ] **Step 4: Run clippy with warnings as errors**

Run: `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`
Expected: PASS

- [ ] **Step 5: Run tests**

Run: `cd src-tauri && cargo test --locked`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "build: remove AI-only Cargo dependencies

Remove reqwest, bytes, futures-util, tokio (net.rs only) and
keyring (secrets.rs only). Keep shared_child (lsp, git), tempfile
(fs), objc2 (main.rs). Stage 3 complete: Rust backend cleaned."
```

---

## Stage 4: Dependency Cleanup, Docs & Verification

### Task 15: Remove AI npm dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove AI packages from `dependencies`**

Remove these from the `dependencies` object in `package.json`:
- `@ai-sdk/anthropic`
- `@ai-sdk/cerebras`
- `@ai-sdk/google`
- `@ai-sdk/groq`
- `@ai-sdk/openai`
- `@ai-sdk/openai-compatible`
- `@ai-sdk/react`
- `@ai-sdk/xai`
- `ai`
- `use-stick-to-bottom`
- `zod`

Keep `streamdown` (used by `src/modules/markdown/MarkdownPreviewPane.tsx`).

- [ ] **Step 2: Update lockfile**

Run: `pnpm install`
Expected: lockfile updated, no errors

- [ ] **Step 3: Run type check and tests**

Run: `pnpm check-types && pnpm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: remove AI npm dependencies

Remove @ai-sdk/* (8 packages), ai, use-stick-to-bottom, zod.
Keep streamdown (shared with markdown preview)."
```

---

### Task 16: Config file cleanup

**Files:**
- Modify: `components.json`
- Modify: `knip.json` (if needed)
- Modify: `.size-limit.json` (if needed)
- Modify: `vite.config.ts` (verify only)

- [ ] **Step 1: Remove `@ai-elements` from `components.json`**

Read `components.json` and remove any `@ai-elements` registry entry. Keep the `@/components/ui` registry.

- [ ] **Step 2: Check `knip.json` for AI paths**

```bash
grep -n "ai-elements\|modules/ai" knip.json
```

Update if it references AI paths.

- [ ] **Step 3: Check `.size-limit.json`**

```bash
grep -n "ai" .size-limit.json
```

Update if it has AI-related bundle limits.

- [ ] **Step 4: Verify `vite.config.ts` has no AI-specific config**

```bash
grep -n "ai-sdk\|ai-elements\|@ai" vite.config.ts
```

The `vscode-languageserver-protocol` alias is for LSP, not AI. Keep it.

- [ ] **Step 5: Run knip**

Run: `pnpm knip`
Expected: PASS (no unused files/exports)

- [ ] **Step 6: Commit**

```bash
git add components.json knip.json .size-limit.json vite.config.ts
git commit -m "chore: remove AI references from config files"
```

---

### Task 17: Documentation updates

**Files:**
- Modify: `TERAX.md`
- Delete: `docs/architecture/ai-subsystem.md`
- Modify: `docs/README.md`
- Modify: `docs/architecture/two-process-model.md`
- Modify: `docs/architecture/security-model.md`
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `CONTRIBUTING.md`
- Modify: `src-tauri/Cargo.toml` (description field)

- [ ] **Step 1: Delete AI subsystem doc**

```bash
rm docs/architecture/ai-subsystem.md
```

- [ ] **Step 2: Update `TERAX.md`**

- Change description from "open-source AI-native terminal emulator" to "open-source terminal IDE"
- Remove the entire "### AI subsystem (`src/modules/ai/`)" section (lines 106-119)
- In the two-process model section, remove `net::*`, `shell::*`, `secrets::*` command descriptions
- Remove the `AiComposerProvider` note in PTY shell integration section
- In the agents module description, remove references to `localAgent`, `managedAgentsStore`, built-in Terax agent; keep terminal coding-agent notification description
- In the statusbar description, remove "AI tools indicator"
- In the shortcuts description, remove `ai.toggle` reference
- Remove `BYOK AI via Vercel AI SDK v6` from the project description
- Remove the `docs/architecture/ai-subsystem.md` reference from "Further reading"
- Update the `Cargo.toml` description in the project section

- [ ] **Step 3: Update `docs/README.md`**

Remove the line referencing `docs/architecture/ai-subsystem.md`.

- [ ] **Step 4: Update `docs/architecture/two-process-model.md`**

Remove AI command catalog entries (`net::*`, `shell::*`, `secrets::*`).

- [ ] **Step 5: Update `docs/architecture/security-model.md`**

Remove AI tool surface references, AI security deny-list references, and AI provider key storage references.

- [ ] **Step 6: Update `README.md`**

Change branding from "AI-native terminal emulator" to "terminal IDE". Remove AI feature descriptions. Update feature list to reflect terminal, editor, explorer, source control, LSP, themes.

- [ ] **Step 7: Update `ROADMAP.md`**

Remove AI-related roadmap items.

- [ ] **Step 8: Update `CONTRIBUTING.md`**

Remove AI provider contribution guidelines (the "Adding a new provider" section and related AI bundle cost justification rules).

- [ ] **Step 9: Update `Cargo.toml` description**

Change:
```toml
description = "Terax — an open-source AI-native terminal emulator"
```
To:
```toml
description = "Terax — an open-source terminal IDE"
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "docs: update documentation for AI-free terminal IDE

Remove AI subsystem docs, update TERAX.md architecture description,
update README/ROADMAP/CONTRIBUTING branding. Remove AI command
references from two-process-model and security-model docs."
```

---

### Task 18: Full verification

- [ ] **Step 1: Run all frontend checks**

```bash
pnpm check-types
pnpm lint
pnpm test
pnpm knip
```
Expected: ALL PASS

- [ ] **Step 2: Run all Rust checks**

```bash
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings
cd src-tauri && cargo test --locked
```
Expected: ALL PASS

- [ ] **Step 3: Launch the app in dev mode**

```bash
pnpm tauri dev
```
Expected: App launches cleanly. Zero console errors. No missing IPC command crashes. Terminal tabs work, editor works, explorer works, source control works, LSP works.

- [ ] **Step 4: Verify terminal agent notifications**

With the app running, open a terminal tab and run a coding agent (e.g., Claude Code). Verify:
- Tab status badge shows agent status (working/waiting)
- NotificationBell shows the agent session
- Hook enable/disable works for Claude/Codex/Gemini/Pi in the NotificationBell popover

- [ ] **Step 5: Verify no AI UI remains**

Confirm there is no AI side-panel, no AI input bar, no AI settings tab, no AI shortcut in the shortcuts dialog. The `editor.codeComplete` shortcut (Ctrl+Space) should still work (native CodeMirror completion).

- [ ] **Step 6: Final commit if any fixes were needed**

If any issues were found and fixed during verification, commit them:

```bash
git add -A
git commit -m "fix: address issues found during final verification"
```

- [ ] **Step 7: Save a memory observation**

After completion, save what was learned to persistent memory.
