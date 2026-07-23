# Project Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `src/modules/spaces/` from a tab-path saver into Project Profiles: each space persists its own sidebar|workspace split ratio (`panelSizes`), auto-launches configured startup commands in ephemeral, non-serialized terminal tabs on first per-session activation, and exposes a settings popover (name, root, accent color, startup commands) per space row.

**Architecture:** A new `useSpaceStartup` hook owns two switch-time side-effects (apply the saved `panelSizes` via the sidebar panel handle; create one cold terminal per `startupCommand`, warm it, then `submitToLeaf` the command on next tick). Per-space `panelSizes` is a percentage pair persisted on `SpaceState` (debounced via the existing `useSpacePersistence` snapshot) and mirrored into a runtime `panelSizesBySpace` map on the `useSpaces` zustand store, seeded at boot from the loaded `states`. Startup-terminal tabs are marked with a runtime-only `startupCommand` field excluded from serialization, so they recreate cleanly each launch without duplication. The settings UI is a self-contained `SpaceSettingsPopover` triggered by a gear `RowAction` inside each `SpaceRow`.

**Tech Stack:** Tauri 2, React 19 (`useRef`/`useEffect`/`useCallback`), Zustand, Vite, Vitest, Biome, TypeScript (`tsc --noEmit`). The Tauri/Rust layer is **untouched** by this plan. Icons: `@hugeicons/core-free-icons`. Persistence: `@tauri-apps/plugin-store` (`terax-spaces.json`). Resizable panel: `react-resizable-panels`.

## Global Constraints

- **No em-dashes.** Use `\u2014`? No — use regular hyphens or parenthetical phrasing in all code comments and prose.
- **Backward compatibility:** All new persisted fields (`SpaceMeta.startupCommands`, `SpaceState.panelSizes`) are optional. Existing `terax-spaces.json` files load unchanged; missing values stay `undefined`.
- **Rust untouched:** `src-tauri/` is NOT modified. `cargo clippy --all-targets --locked -- -D warnings` runs as a regression gate, not new-code gate.
- **Reuse, don't reinvent:** `newTabInSpace` (already returns a tabId), `submitToLeaf` (queues input until pty attaches), `SPACE_COLORS`/`accentFor`, `Popover`/`PopoverContent`, `RowAction` (in `SpaceSwitcher`), `InlineRename` pattern, `persistSidebarWidth` debounce pattern.
- **Ephemeral startup terminals are never serialized** (extend `isSerializableTab`).
- **Ponytail:** No `buildStartupTerminal` helper (duplication of `newTabInSpace`); no env-vars field (deferred); no command reordering; no folder picker; no "run now" button. Explanations stay out of code comments unless requested.
- **Commit after each task.** Conventional commits matching repo style (`feat:`, `test:`, `refactor:`).
- **Icon import path:** `@hugeicons/core-free-icons` (NOT `@hugeicons/react` - that only exports `HugeiconsIcon`).

## File Structure

**Create:**
- `src/modules/spaces/lib/useSpaceStartup.ts` — hook owning startup-command execution + panelSizes-apply on switch/first-activation.
- `src/modules/spaces/components/SpaceSettingsPopover.tsx` — per-space settings editor (name, root, color, startup commands).

**Modify:**
- `src/modules/spaces/lib/store.ts` — `SpaceMeta.startupCommands?`, `SpaceState.panelSizes?`.
- `src/modules/spaces/lib/useSpaces.ts` — `setRoot`, `setStartupCommands`, `setPanelSizes` actions; `panelSizesBySpace` state; `hydrate()` gains param.
- `src/modules/spaces/lib/useSpacesBoot.ts` — seed `panelSizesBySpace` from loaded `states` into `hydrate()`.
- `src/modules/spaces/lib/serialize.ts` — `isSerializableTab` excludes `startupCommand`.
- `src/modules/spaces/lib/serialize.test.ts` — new exclusion case.
- `src/modules/spaces/lib/useSpacePersistence.ts` — flush `panelSizes` into `SpaceState`; call `setPanelSizes`; extend `LastWrite` dedupe.
- `src/modules/spaces/SpaceSwitcher.tsx` — gear `RowAction` + `SpaceSettingsPopover` per row.
- `src/modules/spaces/index.ts` — export `useSpaceStartup`.
- `src/modules/tabs/lib/useTabs.ts` — `TerminalTab.startupCommand?`; `newTabInSpace` optional 3rd param.
- `src/app/App.tsx` — invoke `useSpaceStartup`; define `submitCommand`; thread `activeSidebarPct` into `useSpacePersistence`.

---

### Task 1: Type fields + serialization exclusion (TDD)

**Files:**
- Modify: `src/modules/spaces/lib/store.ts:5-19`
- Modify: `src/modules/tabs/lib/useTabs.ts:29-41` and `useTabs.ts:289-306`
- Modify: `src/modules/spaces/lib/serialize.ts:57-68`
- Test: `src/modules/spaces/lib/serialize.test.ts`

**Interfaces:**
- Consumes: nothing (first task, foundation).
- Produces:
  - `SpaceMeta.startupCommands?: string[]` on `store.ts:5`
  - `SpaceState.panelSizes?: number[]` on `store.ts:16`
  - `TerminalTab.startupCommand?: string` on `useTabs.ts:29`
  - `newTabInSpace(spaceId: string, cwd?: string, startupCommand?: string): number` on `useTabs.ts:289`
  - `isSerializableTab` excludes `tab.startupCommand !== undefined` (terminal branch)

- [ ] **Step 1: Write the failing test**

Append to `src/modules/spaces/lib/serialize.test.ts`, inside the existing top-level `describe("serializeTabs", ...)` block (insert before the closing `});` of that block at line 74). Add a new `it` case:

```typescript
  it("drops startup-command terminals", () => {
    const tabs: Tab[] = [
      term({ id: 1 }),
      term({ id: 2, startupCommand: "pnpm dev" } as Partial<
        Extract<Tab, { kind: "terminal" }>
      >),
      {
        id: 9,
        kind: "editor",
        spaceId: "s1",
        title: "x",
        path: "/a/x.ts",
        dirty: false,
        preview: false,
      },
    ];
    const out = serializeTabs(tabs);
    const ids = out
      .filter((t): t is Extract<SerializedTab, { kind: "terminal" }> => t.kind === "terminal")
      .map((t) => t);
    expect(out.map((t) => t.kind)).toEqual(["terminal", "editor"]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- serialize.test.ts`
Expected: FAIL — the `startupCommand` field does not exist on `TerminalTab` yet (TypeScript error) and `isSerializableTab` does not exclude it. If the test compiles via the `as Partial<...>` cast, it will fail because `out.map` returns `["terminal", "terminal", "editor"]` (both terminals serialized).

- [ ] **Step 3: Add the type fields**

Edit `src/modules/spaces/lib/store.ts`. Replace the `SpaceMeta` and `SpaceState` type definitions (lines 5-19):

```typescript
export type SpaceMeta = {
  id: string;
  name: string;
  root: string | null;
  env: WorkspaceEnv;
  /** Opt-in accent, index into SPACE_COLORS. Undefined = theme primary. */
  color?: number;
  /** Shell commands auto-run in dedicated terminal tabs on first per-session space activation. */
  startupCommands?: string[];
  createdAt: number;
  updatedAt: number;
};

export type SpaceState = {
  tabs: SerializedTab[];
  activeTabIndex: number;
  /** [sidebarPct, workspacePct] for the main sidebar|workspace split. Undefined = use global pref. */
  panelSizes?: number[];
};
```

- [ ] **Step 4: Add `TerminalTab.startupCommand` and extend `newTabInSpace`**

Edit `src/modules/tabs/lib/useTabs.ts`. In `TerminalTab` (lines 29-41), add the runtime-only marker as the last field of the type:

```typescript
export type TerminalTab = TabBase & {
  id: number;
  kind: "terminal";
  title: string;
  cwd?: string;
  paneTree: PaneNode;
  activeLeafId: number;
  blocks?: boolean;
  /** AI agent cannot read buffer / context of this terminal. */
  private?: boolean;
  /** User-set label that overrides the cwd-derived name. Survives cd. */
  customTitle?: string;
  /** Terminal auto-created to run a space startup command; never serialized. */
  startupCommand?: string;
};
```

In the same file, replace `newTabInSpace` (lines 289-306) to accept an optional `startupCommand` and stamp it on the created tab:

```typescript
  // Appends a cold terminal tab to a space without stealing focus, so the
  // overview can populate a space in place; it spawns when first opened.
  // The optional startupCommand stamps a runtime-only marker so the tab is
  // excluded from serialization and identified by the startup hook.
  const newTabInSpace = useCallback(
    (spaceId: string, cwd?: string, startupCommand?: string) => {
      const tabId = nextIdRef.current++;
      const leafId = nextIdRef.current++;
      setTabs((curr) => [
        ...curr,
        {
          id: tabId,
          kind: "terminal",
          spaceId,
          cold: true,
          title: cwd ? basename(cwd) : "shell",
          cwd,
          paneTree: { kind: "leaf", id: leafId, cwd },
          activeLeafId: leafId,
          ...(startupCommand !== undefined && { startupCommand }),
        },
      ]);
      return tabId;
    },
    [],
  );
```

- [ ] **Step 5: Extend `isSerializableTab` to exclude startup terminals**

Edit `src/modules/spaces/lib/serialize.ts:57-68`. Replace the function:

```typescript
export function isSerializableTab(tab: Tab): boolean {
  switch (tab.kind) {
    case "terminal":
      return !tab.private && tab.startupCommand === undefined;
    case "editor":
    case "preview":
    case "markdown":
      return true;
    default:
      return false;
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test -- serialize.test.ts`
Expected: PASS — all `serializeTabs` and `hydrateTabs` cases green, including the new "drops startup-command terminals" case.

- [ ] **Step 7: Run typecheck and lint**

Run: `pnpm check-types && pnpm lint`
Expected: PASS, no new errors. The `startupCommand` cast in the test (`as Partial<...>`) is fine because `TerminalTab.startupCommand` is now declared; you may simplify the cast to just `term({ id: 2, startupCommand: "pnpm dev" })` once the type exists - do so.

- [ ] **Step 8: Commit**

```bash
git add src/modules/spaces/lib/store.ts src/modules/tabs/lib/useTabs.ts \
        src/modules/spaces/lib/serialize.ts src/modules/spaces/lib/serialize.test.ts
git commit -m "feat(spaces): add startupCommands/panelSizes/startupCommand fields

- SpaceMeta.startupCommands?: string[] (auto-run on first per-session activation)
- SpaceState.panelSizes?: number[] (main sidebar|workspace split ratio)
- TerminalTab.startupCommand?: string (runtime-only, excluded from serialization)
- newTabInSpace(spaceId, cwd?, startupCommand?) stamps the marker at creation
- isSerializableTab drops startup-command terminals (test added)"
```

---

### Task 2: `useSpaces` store actions + `panelSizesBySpace` runtime map

**Files:**
- Modify: `src/modules/spaces/lib/useSpaces.ts`
- Modify: `src/modules/spaces/lib/useSpacesBoot.ts:112`
- Test: none (mirrors the untested `setColor` action; covered by manual gate)

**Interfaces:**
- Consumes: `SpaceMeta`, `SpaceState` from Task 1.
- Produces:
  - `useSpaces.setRoot(id: string, root: string | null): void`
  - `useSpaces.setStartupCommands(id: string, cmds: string[]): void`
  - `useSpaces.setPanelSizes(spaceId: string, sizes: number[]): void`
  - `useSpaces.panelSizesBySpace: Record<string, number[]>` (new state field)
  - `useSpaces.hydrate(spaces, activeId, initialActiveIndex?, panelSizesBySpace?)` - 4th param optional

- [ ] **Step 1: Add `setRoot`, `setStartupCommands`, `setPanelSizes` actions and `panelSizesBySpace` state**

Edit `src/modules/spaces/lib/useSpaces.ts`. Extend the `State` type (after `setColor: (id: string, color: number | undefined) => void;` at line 37, and after `setActive:` at line 40) so the type block reads:

```typescript
type State = {
  spaces: SpaceMeta[];
  activeId: string | null;
  hydrated: boolean;
  // Per-space active tab index loaded from disk, so persistence preserves it
  // for spaces the user never visit this session.
  initialActiveIndex: Record<string, number>;
  // Per-space sidebar|workspace split ratios, seeded at boot from SpaceState.panelSizes
  // and kept in sync by useSpacePersistence so switch-time apply is synchronous.
  panelSizesBySpace: Record<string, number[]>;
  hydrate: (
    spaces: SpaceMeta[],
    activeId: string | null,
    initialActiveIndex?: Record<string, number>,
    panelSizesBySpace?: Record<string, number[]>,
  ) => void;
  create: (input: CreateInput) => SpaceMeta;
  rename: (id: string, name: string) => void;
  setEnv: (id: string, env: WorkspaceEnv) => void;
  setColor: (id: string, color: number | undefined) => void;
  setRoot: (id: string, root: string | null) => void;
  setStartupCommands: (id: string, cmds: string[]) => void;
  setPanelSizes: (spaceId: string, sizes: number[]) => void;
  reorder: (orderedIds: string[]) => void;
  remove: (id: string) => string | null;
  setActive: (id: string) => void;
};
```

- [ ] **Step 2: Implement the actions**

In the same file, extend `create()` state initializer (line 44-47 area) to add `panelSizesBySpace: {}`, update `hydrate()` to accept and set `panelSizesBySpace`, and add the three new action implementations. Replace the matching regions so the store body contains:

```typescript
export const useSpaces = create<State>((set, get) => ({
  spaces: [],
  activeId: null,
  hydrated: false,
  initialActiveIndex: {},
  panelSizesBySpace: {},

  hydrate: (spaces, activeId, initialActiveIndex = {}, panelSizesBySpace = {}) => {
    set({ spaces, activeId, initialActiveIndex, panelSizesBySpace, hydrated: true });
  },

  create: (input) => {
    const now = Date.now();
    const meta: SpaceMeta = {
      id: input.id ?? newSpaceId(),
      name: input.name,
      root: input.root,
      env:
        input.env ??
        parseWorkspaceScopeKey(
          usePreferencesStore.getState().defaultWorkspaceEnv,
        ),
      createdAt: now,
      updatedAt: now,
    };
    const spaces = [...get().spaces, meta];
    set({ spaces });
    void saveSpacesList(spaces);
    return meta;
  },

  rename: (id, name) => {
    const spaces = get().spaces.map((s) =>
      s.id === id ? { ...s, name, updatedAt: Date.now() } : s,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  setEnv: (id, env) => {
    const spaces = get().spaces.map((s) =>
      s.id === id ? { ...s, env, updatedAt: Date.now() } : s,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  setColor: (id, color) => {
    const spaces = get().spaces.map((s) =>
      s.id === id ? { ...s, color, updatedAt: Date.now() } : s,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  setRoot: (id, root) => {
    const spaces = get().spaces.map((s) =>
      s.id === id ? { ...s, root, updatedAt: Date.now() } : s,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  setStartupCommands: (id, cmds) => {
    const spaces = get().spaces.map((s) =>
      s.id === id ? { ...s, startupCommands: cmds, updatedAt: Date.now() } : s,
    );
    set({ spaces });
    void saveSpacesList(spaces);
  },

  setPanelSizes: (spaceId, sizes) => {
    set({
      panelSizesBySpace: { ...get().panelSizesBySpace, [spaceId]: sizes },
    });
  },

  reorder: (orderedIds) => {
    const byId = new Map(get().spaces.map((s) => [s.id, s]));
    const next: SpaceMeta[] = [];
    for (const id of orderedIds) {
      const s = byId.get(id);
      if (s) next.push(s);
    }
    for (const s of get().spaces) {
      if (!next.includes(s)) next.push(s);
    }
    if (next.length !== get().spaces.length) return;
    set({ spaces: next });
    void saveSpacesList(next);
  },

  remove: (id) => {
    const prev = get();
    const spaces = prev.spaces.filter((s) => s.id !== id);
    let activeId = prev.activeId;
    if (activeId === id) activeId = spaces[0]?.id ?? null;
    const panelSizesBySpace = { ...prev.panelSizesBySpace };
    delete panelSizesBySpace[id];
    set({ spaces, activeId, panelSizesBySpace });
    void saveSpacesList(spaces);
    void deleteSpaceData(id);
    if (activeId !== prev.activeId) void saveActiveId(activeId);
    return activeId;
  },

  setActive: (id) => {
    if (get().activeId === id) return;
    set({ activeId: id });
    void saveActiveId(id);
  },
}));
```

(That replaces the entire `create<State>` body; keep the existing imports at the top of the file unchanged.)

- [ ] **Step 3: Seed `panelSizesBySpace` at boot**

Edit `src/modules/spaces/lib/useSpacesBoot.ts`. In the main boot flow, build a `panelSizesBySpace` map from the loaded `states` and pass it to `hydrate()`. Replace the block at lines 109-112:

```typescript
        const initialActiveIndex: Record<string, number> = {};
        const panelSizesBySpace: Record<string, number[]> = {};
        for (const [id, st] of states) {
          initialActiveIndex[id] = st.activeTabIndex;
          if (st.panelSizes && Array.isArray(st.panelSizes)) {
            panelSizesBySpace[id] = st.panelSizes;
          }
        }
        useSpaces.getState().hydrate(spaces, active, initialActiveIndex, panelSizesBySpace);
```

- [ ] **Step 4: Run typecheck and lint**

Run: `pnpm check-types && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Run the test suite**

Run: `pnpm test`
Expected: PASS - no regressions (Task 1 test still green; no new tests in this task).

- [ ] **Step 6: Commit**

```bash
git add src/modules/spaces/lib/useSpaces.ts src/modules/spaces/lib/useSpacesBoot.ts
git commit -m "feat(spaces): setRoot/setStartupCommands/setPanelSizes actions

- panelSizesBySpace runtime map seeded at boot from SpaceState.panelSizes
- hydrate() gains optional 4th param
- remove() prunes panelSizesBySpace for the deleted space"
```

---

### Task 3: `useSpaceStartup` hook (apply panelSizes + run startup commands)

**Files:**
- Create: `src/modules/spaces/lib/useSpaceStartup.ts`
- Modify: `src/modules/spaces/index.ts`

**Interfaces:**
- Consumes:
  - `useSpaces` store (`.spaces`, `.activeId`, `.panelSizesBySpace`)
  - `newTabInSpace(spaceId, cwd?, startupCommand?): number` (Task 1)
  - `submitToLeaf(leafId: number, text: string): void` from `@/modules/terminal/lib/useTerminalSession`
  - `sidebarRef: React.RefObject<PanelImperativeHandle | null>` from App's `useSidebarPanel`
- Produces:
  - `useSpaceStartup(params): void` hook (void return; side-effects only)
  - Applies per-space `panelSizes` on `activeSpaceId` change via `sidebarRef.current.resize(\`${sizes[0]}%\`)`
  - Creates one cold terminal per `startupCommand` on first per-session activation of each space; idempotent via an internal `Set<spaceId>` ref

- [ ] **Step 1: Create the hook file**

Create `src/modules/spaces/lib/useSpaceStartup.ts`:

```typescript
import type { PanelImperativeHandle } from "react-resizable-panels";
import type { MutableRefObject } from "react";
import { useSpaces } from "./useSpaces";
import { submitToLeaf } from "@/modules/terminal/lib/useTerminalSession";
import type { Tab } from "@/modules/tabs";
import { useEffect, useRef } from "react";

type Params = {
  /** True once spaces are hydrated from disk and the app is booted. */
  ready: boolean;
  /** The currently active space id (drives both boot-first-run and switch runs). */
  activeSpaceId: string | null;
  /** Latest tabs snapshot, for resolving leafIds of newly created terminal tabs. */
  tabsRef: MutableRefObject<Tab[]>;
  /** Sets the active tab id; used to warm a cold terminal so its pane mounts. */
  setActiveId: (id: number) => void;
  /** Creates a cold terminal tab in the given space (returns its tabId). */
  newTerminalInSpace: (
    spaceId: string,
    cwd?: string,
    startupCommand?: string,
  ) => number;
  /** Live sidebar panel handle; null while the panel is not yet mounted. */
  sidebarRef: MutableRefObject<PanelImperativeHandle | null>;
  /** Ref holding the most recent sidebar width in pixels (for clamp checks). */
  sidebarMinPct: number;
  sidebarMaxPct: number;
};

/**
 * Owns two switch-time side-effects of project profiles:
 *   1. Apply the active space's persisted panelSizes (sidebar|workspace ratio) by
 *      resizing the sidebar panel; uncustomized spaces are left untouched.
 *   2. On first per-session activation of a space, create one cold terminal per
 *      startupCommand, warm it by focusing it, then submit the command to its
 *      leaf on the next tick. Idempotent per-space via a Set ref - switching
 *      back does not re-run.
 */
export function useSpaceStartup({
  ready,
  activeSpaceId,
  tabsRef,
  setActiveId,
  newTerminalInSpace,
  sidebarRef,
  sidebarMinPct,
  sidebarMaxPct,
}: Params) {
  const ranStartup = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!ready || !activeSpaceId) return;

    const { spaces, panelSizesBySpace } = useSpaces.getState();
    const meta = spaces.find((s) => s.id === activeSpaceId);

    // (1) Apply persisted panelSizes for the incoming space, if any.
    const sizes = panelSizesBySpace[activeSpaceId];
    const panel = sidebarRef.current;
    if (sizes && panel && sizes.length >= 1 && typeof sizes[0] === "number") {
      const sidebarPct = Math.min(
        sidebarMaxPct,
        Math.max(sidebarMinPct, sizes[0]),
      );
      panel.resize(`${sidebarPct}%`);
    }

    // (2) Run startup commands on first per-session activation only.
    if (!meta || ranStartup.current.has(activeSpaceId)) return;
    ranStartup.current.add(activeSpaceId);
    const cmds = meta.startupCommands;
    if (!cmds || cmds.length === 0) return;
    const root = meta.root;
    for (const cmd of cmds) {
      const tabId = newTerminalInSpace(activeSpaceId, root ?? undefined, cmd);
      const trySubmit = (attempt: number) => {
        // Resolve the tab by id lazily; it may not be in tabsRef yet on the
        // first synchronous read after setTabs.
        const tab = tabsRef.current.find((t) => t.id === tabId);
        if (!tab || tab.kind !== "terminal") {
          if (attempt < 1) setTimeout(() => trySubmit(attempt + 1), 80);
          return;
        }
        setActiveId(tabId);
        submitToLeaf(tab.activeLeafId, cmd);
      };
      setTimeout(() => trySubmit(0), 80);
    }
  }, [
    ready,
    activeSpaceId,
    tabsRef,
    setActiveId,
    newTerminalInSpace,
    sidebarRef,
    sidebarMinPct,
    sidebarMaxPct,
  ]);
}
```

- [ ] **Step 2: Export the hook from the module barrel**

Edit `src/modules/spaces/index.ts`. Append the export so the file reads:

```typescript
export { SpaceSwitcher } from "./SpaceSwitcher";
export { SpaceAvatar } from "./SpaceAvatar";
export { useSpaces } from "./lib/useSpaces";
export { useSpacesBoot } from "./lib/useSpacesBoot";
export { useSpacePersistence } from "./lib/useSpacePersistence";
export { useSpaceStartup } from "./lib/useSpaceStartup";
export type { SpaceMeta } from "./lib/store";
```

- [ ] **Step 3: Run typecheck and lint**

Run: `pnpm check-types && pnpm lint`
Expected: PASS. The hook is not yet called from `App.tsx` (Task 7 does that), but it must compile on its own. If `pnpm lint` flags unused params, double-check the param names match the destructure; none should be unused.

- [ ] **Step 4: Commit**

```bash
git add src/modules/spaces/lib/useSpaceStartup.ts src/modules/spaces/index.ts
git commit -m "feat(spaces): useSpaceStartup hook for profile auto-launch and panelSizes

- Applies persisted panelSizes on activeSpaceId change via sidebarRef.resize
- Runs startupCommands once per session per space (idempotent Set ref)
- Per command: newTerminalInSpace -> setActiveId (warm) -> submitToLeaf next tick
- Bounded one-retry (80ms) for the cold-tab attach race"
```

---

### Task 4: `useSpacePersistence` flushes `panelSizes`

**Files:**
- Modify: `src/modules/spaces/lib/useSpacePersistence.ts`

**Interfaces:**
- Consumes:
  - `useSpaces.setPanelSizes(spaceId, sizes)` (Task 2)
  - `saveState(spaceId, state)` from `./store`
- Produces: `useSpacePersistence` gains an optional `activeSidebarPct?: number` param; the flushed `SpaceState` includes `panelSizes: [activeSidebarPct, 100 - activeSidebarPct]` when defined.

- [ ] **Step 1: Extend the persistence params and dedupe shape**

Edit `src/modules/spaces/lib/useSpacePersistence.ts`. Replace the type declarations at the top (lines 1-16) with:

```typescript
import { useCallback, useEffect, useRef } from "react";
import type { Tab } from "@/modules/tabs";
import { isSerializableTab, serializeTabs } from "./serialize";
import { saveState } from "./store";
import { useSpaces } from "./useSpaces";

const DEBOUNCE_MS = 3000;

type Snapshot = { tabs: Tab[]; activeId: number; activeSpaceId: string };

type Params = Snapshot & {
  /** Gate writes until boot hydration finished, so restore never round-trips. */
  enabled: boolean;
  /** Latest sidebar width as a percentage of the main panel group. When defined,
   *  it is written into the active space's SpaceState.panelSizes. */
  activeSidebarPct?: number;
};

type LastWrite = { json: string; activeTabIndex: number; panelSizes?: number[] };
```

- [ ] **Step 2: Include `panelSizes` in the flush path**

In the same file, replace the `flush` callback body (lines 42-71) with:

```typescript
  const flush = useCallback((snap: Snapshot, activeSidebarPct?: number) => {
    const groups = new Map<string, Tab[]>();
    for (const t of snap.tabs) {
      const arr = groups.get(t.spaceId);
      if (arr) arr.push(t);
      else groups.set(t.spaceId, [t]);
    }

    const setPct = useSpaces.getState().setPanelSizes;
    for (const [spaceId, group] of groups) {
      const serialized = serializeTabs(group);
      const prev = last.current.get(spaceId);
      let activeTabIndex = prev?.activeTabIndex ?? 0;
      if (spaceId === snap.activeSpaceId) {
        const idx = group
          .filter(isSerializableTab)
          .findIndex((t) => t.id === snap.activeId);
        if (idx >= 0) activeTabIndex = idx;
      }
      const json = JSON.stringify(serialized);
      const panelSizes =
        spaceId === snap.activeSpaceId &&
        typeof activeSidebarPct === "number" &&
        Number.isFinite(activeSidebarPct)
          ? [activeSidebarPct, 100 - activeSidebarPct]
          : prev?.panelSizes;
      if (
        prev &&
        prev.json === json &&
        prev.activeTabIndex === activeTabIndex &&
        JSON.stringify(prev.panelSizes) === JSON.stringify(panelSizes)
      ) {
        continue;
      }
      last.current.set(spaceId, { json, activeTabIndex, panelSizes });
      void saveState(spaceId, {
        tabs: serialized,
        activeTabIndex,
        ...(panelSizes && { panelSizes }),
      });
      if (spaceId === snap.activeSpaceId && panelSizes) {
        setPct(spaceId, panelSizes);
      }
    }
  }, []);
```

- [ ] **Step 3: Update the effect call sites to pass `activeSidebarPct`**

In the same file, update the debounced-write effect (around line 73-84) and the visibility/blur effect (around line 86-101). Replace those two effects with:

```typescript
  useEffect(() => {
    if (!enabled) return;
    const snap: Snapshot = { tabs, activeId, activeSpaceId };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      flush(snap, activeSidebarPct);
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [tabs, activeId, activeSpaceId, activeSidebarPct, enabled, flush]);

  useEffect(() => {
    if (!enabled) return;
    const onHidden = () => {
      if (document.visibilityState === "hidden")
        flush(latest.current, activeSidebarPct);
    };
    const onLeave = () => flush(latest.current, activeSidebarPct);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("blur", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener<"blur">("blur", onLeave);
      window.removeEventListener("beforeunload", onLeave);
      flush(latest.current, activeSidebarPct);
    };
  }, [enabled, activeSidebarPct, flush]);
```

Also add `activeSidebarPct` to the `latest.current` ref sync that already exists at the top of the hook body (the line `latest.current = { tabs, activeId, activeSpaceId };`). Destructure `activeSidebarPct` from `Params` in the function signature (it currently only destructures `tabs, activeId, activeSpaceId, enabled`).

- [ ] **Step 4: Run typecheck, lint, and tests**

Run: `pnpm check-types && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/spaces/lib/useSpacePersistence.ts
git commit -m "feat(spaces): persist panelSizes into SpaceState (debounced)

- Params +activeSidebarPct
- LastWrite dedupe extended with panelSizes
- flush writes SpaceState.panelSizes && keeps useSpaceStore in sync via setPanelSizes"
```

---

### Task 5: `SpaceSettingsPopover` component

**Files:**
- Create: `src/modules/spaces/components/SpaceSettingsPopover.tsx`

**Interfaces:**
- Consumes:
  - `SpaceMeta` from `./lib/store`
  - `SPACE_COLORS`, `accentFor` from `./lib/spaceColor`
  - `useSpaces` actions: `rename`, `setRoot`, `setColor`, `setStartupCommands`
  - `Popover`/`PopoverTrigger`/`PopoverContent` from `@/components/ui/popover`
  - `HugeiconsIcon` from `@hugeicons/react`; `Settings01Icon`, `Cancel01Icon`, `PlusSignIcon` from `@hugeicons/core-free-icons`
- Produces: `<SpaceSettingsPopover space={...} trigger={...} />` self-contained editor; live-saves each field via the store.

- [ ] **Step 1: Create the component**

Create `src/modules/spaces/components/SpaceSettingsPopover.tsx`:

```tsx
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { SPACE_COLORS, accentFor } from "../lib/spaceColor";
import type { SpaceMeta } from "../lib/store";
import { useSpaces } from "../lib/useSpaces";
import { Cancel01Icon, PlusSignIcon, Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

type Props = {
  space: SpaceMeta;
  /** Trigger element; typically a RowAction gear rendered by SpaceSwitcher. */
  trigger: React.ReactNode;
};

export function SpaceSettingsPopover({ space, trigger }: Props) {
  const rename = useSpaces((s) => s.rename);
  const setRoot = useSpaces((s) => s.setRoot);
  const setColor = useSpaces((s) => s.setColor);
  const setStartupCommands = useSpaces((s) => s.setStartupCommands);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(space.name);
  const [root, setRootField] = useState(space.root ?? "");
  const [cmds, setCmds] = useState<string[]>(space.startupCommands ?? []);
  const [draft, setDraft] = useState("");

  // Re-sync local fields when the popover opens (space may have been edited elsewhere).
  useEffect(() => {
    if (!open) return;
    setName(space.name);
    setRootField(space.root ?? "");
    setCmds(space.startupCommands ?? []);
    setDraft("");
  }, [open, space.name, space.root, space.startupCommands]);

  const commitName = (v: string) => {
    const trimmed = v.trim();
    if (trimmed && trimmed !== space.name) rename(space.id, trimmed);
    else setName(space.name);
  };
  const commitRoot = (v: string) => {
    const next = v.trim() || null;
    if (next !== space.root) setRoot(space.id, next);
    else setRootField(space.root ?? "");
  };
  const addCommand = () => {
    const v = draft.trim();
    if (!v) return;
    const next = [...cmds, v];
    setCmds(next);
    setStartupCommands(space.id, next);
    setDraft("");
  };
  const removeCommand = (idx: number) => {
    const next = cmds.filter((_, i) => i !== idx);
    setCmds(next);
    setStartupCommands(space.id, next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[22rem] p-3"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <HugeiconsIcon icon={Settings01Icon} size={14} strokeWidth={1.75} />
            <span>Space settings</span>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Name
            </span>
            <input
              aria-label="Space name"
              defaultValue={name}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitName(e.currentTarget.value);
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              onBlur={(e) => commitName(e.currentTarget.value)}
              className="w-full rounded-md bg-background px-2 py-1 text-xs ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Root directory
            </span>
            <input
              aria-label="Space root directory"
              defaultValue={root}
              value={root}
              onChange={(e) => setRootField(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRoot(e.currentTarget.value);
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              onBlur={(e) => commitRoot(e.currentTarget.value)}
              placeholder={space.root ?? "/path/to/project"}
              className="w-full rounded-md bg-background px-2 py-1 font-mono text-[11px] ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Accent color
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                aria-label="Theme primary"
                onClick={() => setColor(space.id, undefined)}
                className={cn(
                  "size-5 rounded-full ring-1 ring-inset transition",
                  space.color == null
                    ? "ring-foreground/80"
                    : "ring-border hover:ring-foreground/40",
                )}
                style={{ backgroundColor: "var(--primary)" }}
              />
              {SPACE_COLORS.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Accent ${i + 1}`}
                  onClick={() => setColor(space.id, i)}
                  className={cn(
                    "size-5 rounded-full ring-1 ring-inset transition",
                    space.color === i
                      ? "ring-foreground/80"
                      : "ring-transparent hover:ring-foreground/40",
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Startup commands
            </span>
            <div className="flex flex-col gap-1">
              {cmds.map((c, i) => (
                <div
                  key={`${c}-${i}`}
                  className="flex items-center gap-1.5 rounded-md bg-muted/50 px-1.5 py-1"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                    {c}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove command"
                    onClick={() => removeCommand(i)}
                    className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
                  </button>
                </div>
              ))}
              {cmds.length === 0 && (
                <span className="px-1 text-[10.5px] text-muted-foreground/60">
                  No startup commands
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                aria-label="New startup command"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCommand();
                  }
                }}
                placeholder="pnpm dev"
                className="min-w-0 flex-1 rounded-md bg-background px-2 py-1 font-mono text-[11px] ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                aria-label="Add command"
                onClick={addCommand}
                disabled={!draft.trim()}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Run typecheck and lint**

Run: `pnpm check-types && pnpm lint`
Expected: PASS. The component is not yet mounted by `SpaceSwitcher` (Task 6 wires it) but must compile standalone.

- [ ] **Step 3: Commit**

```bash
git add src/modules/spaces/components/SpaceSettingsPopover.tsx
git commit -m "feat(spaces): SpaceSettingsPopover for name/root/color/startup commands

- Live-saves each field via useSpaces rename/setRoot/setColor/setStartupCommands
- Re-syncs local state on open
- Reuses Popover primitives; gear trigger passed in as ReactNode"
```

---

### Task 6: Gear `RowAction` + popover wiring in `SpaceSwitcher`

**Files:**
- Modify: `src/modules/spaces/SpaceSwitcher.tsx`

**Interfaces:**
- Consumes:
  - `SpaceSettingsPopover` (Task 5)
  - `Settings01Icon` from `@hugeicons/core-free-icons`
  - Existing `RowAction` helper in `SpaceSwitcher.tsx:619`
  - `SpaceMeta` type

- [ ] **Step 1: Add imports**

In `src/modules/spaces/SpaceSwitcher.tsx`, add to the icon import block (lines 10-17, currently importing `ArrowDown01Icon, ArrowRight01Icon, Cancel01Icon, Delete02Icon, PencilEdit02Icon, PlusSignIcon`). Replace that block with:

```tsx
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
```

And near the other local imports (after the `./components/InlineRename` import at line 21), add:

```tsx
import { SpaceSettingsPopover } from "./components/SpaceSettingsPopover";
```

- [ ] **Step 2: Render the gear RowAction + popover in `SpaceRow`**

In the same file, inside `SpaceRow` (the JSX around lines 453-472 where the action cluster renders `RowAction` entries for rename / new tab / delete). Replace that `<div data-no-drag ...>` block with one that prepends a `SpaceSettingsPopover` whose trigger is a `RowAction` gear:

```tsx
            <div
              data-no-drag
              className="hidden shrink-0 items-center gap-0.5 group-hover:flex"
            >
              <SpaceSettingsPopover
                space={space}
                trigger={
                  <RowAction
                    icon={Settings01Icon}
                    label="Space settings"
                    onClick={() => {}}
                  />
                }
              />
              <RowAction
                icon={PencilEdit02Icon}
                label="Rename space"
                onClick={onStartRename}
              />
              <RowAction icon={PlusSignIcon} label="New tab" onClick={onNewTab} />
              {canDelete && (
                <RowAction
                  icon={Delete02Icon}
                  label="Delete space"
                  destructive
                  onClick={onDelete}
                />
              )}
            </div>
```

(The `onClick={() => {}}` no-op on the `RowAction` trigger is required because `RowAction` always attaches an `onClick`; the popover opens via its own trigger wrapper, so the click handler is intentionally inert. `RowAction` renders a button which `PopoverTrigger asChild` wraps.)

- [ ] **Step 3: Verify `RowAction` accepts the `icon` prop as a `Settings01Icon`-shaped value**

Read `src/modules/spaces/SpaceSwitcher.tsx` around line 619 to confirm the `RowAction` signature is roughly:

```tsx
function RowAction({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) { ... }
```

If the existing `RowAction` props already accept `PencilEdit02Icon` etc., `Settings01Icon` will work without type changes. If `RowAction` types `icon` too narrowly, widen it to `React.ComponentType<{ size?: number; strokeWidth?: number }>`. Run `pnpm check-types` next; if it errors on the gear `RowAction`, widen the prop type.

- [ ] **Step 4: Run typecheck, lint, and tests**

Run: `pnpm check-types && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/spaces/SpaceSwitcher.tsx
git commit -m "feat(spaces): gear RowAction opens SpaceSettingsPopover per row

- Settings01Icon trigger prepended to the row action cluster
- Popover stopPropagation on pointer down/click keeps the drag row intact"
```

---

### Task 7: Wire `useSpaceStartup` + `activeSidebarPct` into `App.tsx`

**Files:**
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes:
  - `useSpaceStartup` (Task 3)
  - `useSpacePersistence` with `activeSidebarPct` (Task 4)
  - `newTabInSpace` (already destructured at App.tsx:105)
  - `SIDEBAR_MIN_WIDTH`, `SIDEBAR_MAX_WIDTH` from the sidebar module (already imported at App.tsx:42-43)
  - `sidebarRef`, `sidebarWidthRef` from `useSidebarPanel`
  - `spacesHydrated`, `activeSpaceId`, `tabs`, `activeId`, `setActiveId` (all already in scope)
- Produces: startup auto-launch + panelSizes apply run on the live app; sidebar resize writes flow into `SpaceState.panelSizes`.

- [ ] **Step 1: Add imports**

In `src/app/App.tsx`, add `useSpaceStartup` to the `@/modules/spaces` import block (currently lines 51-56) so it reads:

```tsx
import {
  SpaceSwitcher,
  useSpacePersistence,
  useSpaces,
  useSpaceStartup,
  useSpacesBoot,
} from "@/modules/spaces";
```

- [ ] **Step 2: Track the live sidebar percentage**

In the `App` component body, after `useSidebarPanel(explorerRef)` returns (around line 266), add a ref holding the latest sidebar-percentage read from the ResizablePanel's `onResize`:

```tsx
  const activeSidebarPctRef = useRef<number | undefined>(undefined);
  const [activeSidebarPct, setActiveSidebarPct] = useState<number | undefined>(
    undefined,
  );
```

(`useRef` and `useState` are already imported at line 84.)

- [ ] **Step 3: Read the sidebar percentage on resize**

In the sidebar `<ResizablePanel onResize={...}>` block (around App.tsx:1043-1059), extend the existing `onResize` handler so it also records `size.asPercentage` for the active space:

```tsx
              <ResizablePanel
                id="sidebar"
                panelRef={sidebarRef}
                defaultSize={
                  initialSidebarCollapsed
                    ? "0px"
                    : `${sidebarWidthRef.current}px`
                }
                minSize={`${SIDEBAR_MIN_WIDTH}px`}
                maxSize={`${SIDEBAR_MAX_WIDTH}px`}
                collapsible
                collapsedSize={0}
                onResize={(size) => {
                  if (size.inPixels > 0) persistSidebarWidth(size.inPixels);
                  persistSidebarCollapsed(size.inPixels <= 0);
                  if (size.inPixels > 0 && size.asPercentage > 0) {
                    const pct = size.asPercentage;
                    activeSidebarPctRef.current = pct;
                    setActiveSidebarPct(pct);
                  }
                }}
              >
```

- [ ] **Step 4: Invoke `useSpaceStartup`**

Just after `useSpacePersistence({ ... })` (around App.tsx:215-220), add the call to `useSpaceStartup`:

```tsx
  useSpaceStartup({
    ready: spacesHydrated,
    activeSpaceId,
    tabsRef,
    setActiveId,
    newTerminalInSpace: newTabInSpace,
    sidebarRef,
    sidebarMinPct: Math.round((SIDEBAR_MIN_WIDTH / window.innerWidth) * 100) || 10,
    sidebarMaxPct: Math.round((SIDEBAR_MAX_WIDTH / window.innerWidth) * 100) || 50,
  });
```

(These min/max percentages convert the px bounds to a percentage range for the hook's clamp; the `|| 10` / `|| 50` fallbacks cover the SSR/zero-width case. If `window.innerWidth` is unavailable at first render, React still runs in the browser so it is defined.)

- [ ] **Step 5: Thread `activeSidebarPct` into `useSpacePersistence`**

Update the `useSpacePersistence` call (around App.tsx:215) so it reads:

```tsx
  useSpacePersistence({
    tabs,
    activeId,
    activeSpaceId: activeSpaceId ?? DEFAULT_SPACE_ID,
    enabled: spacesHydrated,
    activeSidebarPct,
  });
```

- [ ] **Step 6: Run typecheck, lint, and tests**

Run: `pnpm check-types && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat(spaces): wire useSpaceStartup and panelSizes persistence in App

- useSpaceStartup runs startup commands + applies panelSizes on switch
- onResize records activeSidebarPct; useSpacePersistence flushes panelSizes
- min/max pct clamps derived from SIDEBAR_MIN/MAX_WIDTH"
```

---

### Task 8: Full verification (all quality gates + tauri dev smoke)

**Files:** none modified; verification only.

**Interfaces:** None.

- [ ] **Step 1: Typecheck**

Run: `pnpm check-types`
Expected: PASS, zero errors.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: PASS, zero errors.

- [ ] **Step 3: Tests**

Run: `pnpm test`
Expected: PASS, including the new `serialize.test.ts` "drops startup-command terminals" case.

- [ ] **Step 4: Rust clippy regression gate**

Run: `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`
Expected: PASS (Rust untouched by this plan; this confirms no drift in the backend).

- [ ] **Step 5: Manual smoke with `pnpm tauri dev`**

Start the app: `pnpm tauri dev`

Perform the spec's smoke sequence:

1. Create a 2nd space via the Spaces popover's "New space" button.
2. Open that 2nd space's settings popover (gear icon on its row). Set `startupCommands: ["pnpm dev"]` (or any harmless command like `echo hello`) and set an accent color.
3. Drag the sidebar wider (e.g., to ~380px) while the 2nd space is active.
4. Switch to the default space (sidebar visible in the overview or via the cycle shortcut).
5. Switch back to the 2nd space:
   - Sidebar restores to the ~380px width you set.
   - A terminal tab `pnpm dev` (or `echo hello`) appears and the command runs once.
6. Switch away and back to the 2nd space a second time:
   - No second terminal tab is created (idempotent per-session).
7. Close the app fully. Relaunch into the 2nd space:
   - The startup terminal is re-created and the command re-runs (ephemeral/non-serialized).
   - The sidebar width restores to ~380px (panelSizes persisted on disk).
8. Switch to the default (uncustomized) space:
   - The sidebar stays at the last width (no panelSizes for the default space; global pref behavior preserved).
   - No terminal spawns.

Expected: all behaviors match; no console/runtime errors in the devtools console or the Tauri terminal.

- [ ] **Step 6: Final commit (if anything drifted)**

If the verification surfaced micro-fixes (e.g., a clamp tweak), stage them with: `git add -p && git commit -m "fix(spaces): <details>"`. Otherwise, do not commit - the task produces no code changes.

---

## Self-Review

**Spec coverage** - each spec section maps to a task:

- Data model (SpaceMeta.startupCommands, SpaceState.panelSizes, TerminalTab.startupCommand, serialization exclusion) -> Task 1.
- Backward compatibility (optional fields, no migration) -> Task 1 (types optional) + Task 2 (hydrate seeds from disk, undefined-safe).
- Startup-command execution (useSpaceStartup, idempotent Set, next-tick submitToLeaf, ephemeral non-persisted tabs) -> Task 3 (hook) + Task 7 (App wire-up).
- Panel-size persistence & reconciliation (percentages, debounced via useSpacePersistence, apply on switch, global pref seeds only, collapsed orthogonal) -> Task 4 (persistence) + Task 7 (onResize + hook apply).
- Settings UI (gear trigger per row, SpaceSettingsPopover with name/root/color/commands, setRoot + setStartupCommands live-save) -> Task 5 (popover) + Task 6 (wire gear).
- Testing & verification (extend serialize.test, manual gate, four quality gates + tauri dev smoke) -> Task 1 (test) + Task 8 (gates + smoke).

**Placeholder scan** - no "TBD", "add appropriate error handling", "similar to Task N", or empty code blocks. Every code step shows the full code.

**Type consistency**:
- `newTabInSpace(spaceId, cwd?, startupCommand?)` - Task 1 define, Task 7 call (as `newTerminalInSpace`), Task 3 type it.
- `submitToLeaf(leafId, text)` - Task 3 import and call, returns void (hook treats as best-effort; the 80ms retry covers the cold-tab race).
- `useSpaceStartup` params - Task 3 declares, Task 7 passes matching names (`ready`, `activeSpaceId`, `tabsRef`, `setActiveId`, `newTerminalInSpace`, `sidebarRef`, `sidebarMinPct`, `sidebarMaxPct`).
- `useSpacePersistence` params - Task 4 adds `activeSidebarPct?: number`, Task 7 passes it.
- `useSpaces` actions - Task 2 declares `setRoot`, `setStartupCommands`, `setPanelSizes`; Task 4 calls `setPanelSizes`, Task 5 calls `rename`/`setRoot`/`setColor`/`setStartupCommands`.
- `TerminalTab.startupCommand` - Task 1 declares, Task 1's `newTabInSpace` stamps it, Task 3's hook relies on Task 1's creation path (does not set it itself - it passes the 3rd arg).
- `panelSizesBySpace` - Task 2 state + Task 2 `hydrate` seed (via Task 2 Step 3 in useSpacesBoot) + Task 3 read + Task 4 write (via setPanelSizes).

**Implementation refinement recorded**: `startupCommand` stamping on the tab happens in `newTabInSpace` (the creation chokepoint) rather than via a separate `updateTab`/`TabPatch` round-trip - this avoids extending `TabPatch` and the per-kind field-mapping in `updateTab` (which doesn't spread generically). The spec's "via `updateTab` patch" intent ("stamp the resulting tab") is preserved exactly via this single-chokepoint path; the change is within the spec's design boundaries (the spec does not mandate the `updateTab` mechanism, only that the tab carries `startupCommand`).