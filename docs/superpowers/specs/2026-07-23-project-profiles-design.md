# Design: Project Profiles — Auto-Launch Startup Commands & Panel-Size Persistence

**Date:** 2026-07-23
**Status:** Approved (brainstorming complete, pending implementation plan)

## Goal

Upgrade the existing `src/modules/spaces/` module from a tab-path-only saver into
full **Project Profiles**. Each space gains:

1. **Panel-split ratio persistence** — `panelSizes: number[]` on `SpaceState`,
   capturing the main `sidebar | workspace` split so each project restores its
   own sidebar width on switch and on launch.
2. **Startup-command auto-launch** — `startupCommands?: string[]` on `SpaceMeta`,
   auto-created in dedicated terminal tabs on first per-session activation of a
   space (on launch the active space counts as first activation; on every later
   switch into a not-yet-activated space).
3. **Settings UI** — a popover per space row in `SpaceSwitcher` to edit name, root
   directory, accent color, and the startup-commands list.

Backward compatibility with existing `terax-spaces.json` data is preserved; all new
fields are optional and loaded transparently.

## Decisions (from brainstorming)

1. **Startup-command lifecycle: once-per-session, ephemeral.** Run on first
   activation of a space each session; boot counts as the active space's first
   activation. Startup terminals are **not serialized** (excluded like `private`
   tabs), so each app launch re-creates and re-runs them cleanly. Switching back
   to an already-activated space does not re-run. No stale/duplicate accumulation.

2. **`panelSizes` scope: main `sidebar | workspace` split only.** A 2-element
   percentage array on `SpaceState`. Per-tab terminal pane-split ratios are out of
   scope (their structure is already persisted via `paneTree`; ratios for those
   could be a separate future item).

3. **Space-specific env vars: deferred entirely.** Out of scope for this spec to
   keep Rust untouched. Env-vars injection through `pty_open` becomes a follow-up
   spec with its own design (PTY env injection has real edge cases: shells `cd`-ing,
   child processes, Windows/WSL). The settings UI does not surface env vars yet.

4. **Integration approach A: a new `useSpaceStartup` hook owns the startup
   lifecycle (boot + switch, idempotent via a `Set<spaceId>` ref).** Per-space
   `panelSizes` overlays the existing global sidebar-width pref. Minimal churn in
   `App.tsx`; `useSpacesBoot` stays boot-only.

## Architecture & Boundary

### Add

**Frontend (`src/modules/spaces/`):**

- **`lib/store.ts`**
  - `SpaceMeta.startupCommands?: string[]` (optional)
  - `SpaceState.panelSizes?: number[]` (optional — `[sidebarPct, workspacePct]`)
- **`lib/useSpaces.ts`** — two new actions mirroring the existing `setColor`:
  - `setRoot(id, root: string | null) => void`
  - `setStartupCommands(id, cmds: string[]) => void`
- **`lib/useSpaceStartup.ts`** (new) — hook owning the startup-command lifecycle.
- **`lib/useSpacePersistence.ts`** — extend the flushed `SpaceState` with an
  optional `panelSizes` (debounced snapshot of the active space's sidebar
  percentage); extend `LastWrite` dedupe shape accordingly.
- **`components/SpaceSettingsPopover.tsx`** (new) — per-space settings editor,
  reused `Popover` primitives.
- **`SpaceSwitcher.tsx`** — add the gear trigger to each `SpaceRow`'s action
  cluster; render `<SpaceSettingsPopover>` per row.
- **`index.ts`** — export `useSpaceStartup`.

**Cross-module (`src/app/App.tsx`, `src/modules/tabs/lib/useTabs.ts`):**

- `TerminalTab.startupCommand?: string` (runtime-only marker).
- `serialize.ts` `isSerializableTab` extended to exclude
  `tab.startupCommand !== undefined`.
- `App.tsx` — invoke `<useSpaceStartup(...)>` adjacent to `useSpacesBoot`; pass the
  active sidebar percentage into `useSpacePersistence`; apply `panelSizes` on
  switch via `sidebarRef.current.resize(...)`.

### Preserve

- `serializeTabs` / `hydrateTabs` — unchanged behavior; the `startupCommand`
  marker is runtime-only, never in `SerializedTab`, so hydration is unaffected.
- Existing saved spaces in `terax-spaces.json` — missing optional fields load as
  `undefined`; no migration needed.
- Workspace-switcher integrations, sidebar collapse/expand, terminal pane-split
  serialization.

### Out of Scope

- Space-specific environment variables (deferred — see Decision 3).
- Per-tab terminal pane-split ratio persistence (only the main split is captured).
- Root folder-picker dialog (root is a text input in v1).
- Startup-command reordering, shell-quoting/validation, and a manual
  "run now" button (switching to the space already runs them once per session).
- Migration of the global `terax.sidebar.width` pref — it remains the seed for
  uncustomized spaces.

## Data Model

### `SpaceMeta` (`lib/store.ts`)

```ts
export type SpaceMeta = {
  id: string;
  name: string;
  root: string | null;
  env: WorkspaceEnv;
  color?: number;
  startupCommands?: string[]; // NEW — e.g. ["pnpm dev", "pi"]
  createdAt: number;
  updatedAt: number;
};
```

### `SpaceState` (`lib/store.ts`)

```ts
export type SpaceState = {
  tabs: SerializedTab[];
  activeTabIndex: number;
  panelSizes?: number[]; // NEW — [sidebarPct, workspacePct], e.g. [22, 78]
};
```

### `TerminalTab` (`src/modules/tabs/lib/useTabs.ts`)

```ts
export type TerminalTab = TabBase & {
  id: number;
  kind: "terminal";
  title: string;
  cwd?: string;
  paneTree: PaneNode;
  activeLeafId: number;
  blocks?: boolean;
  private?: boolean;
  customTitle?: string;
  /** Terminal auto-created to run a space startup command; never serialized. */
  startupCommand?: string; // NEW — runtime-only
};
```

### Backward compatibility

All three additions are optional. `loadAll()` already casts `v as SpaceState`; a
missing `panelSizes`/`startupCommands` stays `undefined`, so existing
`terax-spaces.json` files load unchanged. Restored tabs never carry
`startupCommand` (it's not in `SerializedTab`), so `hydrateTabs` is unaffected. No
schema migration; the default-space bootstrap path in `useSpacesBoot` is unchanged.

### Serialization exclusion

`isSerializableTab` in `serialize.ts` currently excludes `private` terminals:

```ts
export function isSerializableTab(tab: Tab): boolean {
  switch (tab.kind) {
    case "terminal":
      return !tab.private;
    // ...
  }
}
```

Extended to also exclude startup terminals:

```ts
case "terminal":
  return !tab.private && tab.startupCommand === undefined;
```

## Startup-Command Execution

### `useSpaceStartup` hook (`lib/useSpaceStartup.ts`, new)

```ts
type Params = {
  ready: boolean;                 // spacesHydrated
  activeSpaceId: string | null;
  tabsRef: MutableRefObject<Tab[]>;
  newTerminalInSpace: (spaceId: string, opts: { cwd?: string | null }) => number;
  submitCommand: (tabId: number, command: string) => void;
};
```

Internal state: `ranStartup = useRef<Set<string>>(new Set())`.

**Triggers** — runs after boot hydration resolves (first activation of the active
space) and on every `activeSpaceId` change thereafter.

**Flow** for the active space:
1. If `ranStartup.current.has(spaceId)` → exit.
2. Add `spaceId` to `ranStartup.current` (mark before side-effects to be re-entrant
   safe).
3. If `meta.startupCommands?.length` is falsy → exit (no terminal created; default
   space unaffected).
4. For each `command` in `startupCommands`:
   - `tabId = newTerminalInSpace(spaceId, { cwd: meta.root ?? null })`.
   - Stamp the resulting tab with `startupCommand: command` via `updateTab` patch
     (so it persists for the lifetime of the runtime tab and is excluded from
     serialization).
   - Schedule `submitCommand(tabId, command)` on the next tick.

**`newTerminalInSpace`** — provided by `App.tsx`, reusing the existing
`onNewTabInSpace` wiring already passed to `SpaceSwitcher` (a space-scoped
terminal-tab creator). The new tab becomes live and registers its `TerminalPane`
ref. The `cwd` option targets `meta.root` so the command runs in the project root.

**`submitCommand(tabId, command)`** — mirrors `cdInNewTab` (`App.tsx:424`):
resolves the tab's `activeLeafId` from `tabsRef`, then calls
`submitToLeaf(leafId, command)` (in `useTerminalSession.ts`), which **queues input
until the PTY attaches** (`queuePendingInput`) — handling the cold→live attach race.
If the leaf session isn't ready yet, retry once on a short `setTimeout` (bounded to
one retry, same 80ms wait pattern as `cdInNewTab`). `submitToLeaf`'s bracketed-paste
path keeps multi-line commands atomic; the trailing CR runs them.

**Tab shape** — regular `Terminal` tabs, `blocks: false`, `cwd = meta.root ??
inheritedCwd`. Title derived from `meta.root` basename or `"startup"`. They live in
the space's tab list like any other, can be closed/rearranged by the user, but are
not persisted (serialization exclusion). Next app launch recreates and re-runs them
on first activation — no duplicates.

**Boot vs. switch** — `useSpacesBoot`'s final lines do **not** mark
`ranStartup`. Boot just sets the active space normally. The new hook's boot trigger
(it also depends on `ready`) handles the active space's first run. This isolates
"launch" from "switch"; both flow through the same idempotent path.

**No-op safety** — empty/missing `startupCommands` → hook adds the space to
`ranStartup` and exits. No terminal created.

**No separate helper** — the tab is created through the existing
`newTerminalInSpace` flow and stamped via `updateTab`; no bespoke
`buildStartupTerminal` helper is introduced (it would duplicate
`freshTerminalTab` and sit off the hot path). The non-trivial logic that must hold
is the serialization exclusion, covered by the extended `serialize.test.ts`.

## Panel-Size Persistence & Reconciliation

The sidebar is pixel-sized today (`useSidebarPanel`, global
`terax.sidebar.width` localStorage). Per-space `panelSizes` stores **percentages**
so it survives window-width changes.

**Apply on switch** — folded into `useSpaceStartup` (keeps all switch-time
side-effects together): when `activeSpaceId` changes and the new space's saved
`SpaceState.panelSizes` exists, call
`sidebarRef.current.resize(\`${sizes[0]}%\`)`. If the space has no `panelSizes`,
leave the sidebar at its current width (defer to the global pref / last size — no
surprise jumps for uncustomized/default spaces). Collapsed state
(`persistSidebarCollapsed`) is orthogonal and stays global — `panelSizes` only
overrides the *width*, not collapsed/expanded.

**Save on resize** — the sidebar `<ResizablePanel onResize={...}>` at
`App.tsx:1055` currently calls `persistSidebarWidth(size.inPixels)` +
`persistSidebarCollapsed`. Add: also thread `size.asPercentage` into the active
space's `SpaceState.panelSizes`, via `useSpacePersistence`:

- `useSpacePersistence` already debounces `saveState(spaceId, { tabs,
  activeTabIndex })`. It gains an optional `activeSidebarPct?: number` prop (the
  latest sidebar percentage for the active space) and includes it in the flushed
  `SpaceState` as `panelSizes: [activeSidebarPct, remainder]`.
- The `LastWrite` shape grows to
  `{ json, activeTabIndex, panelSizes }` to keep the dedupe correct
  (`panelSizes` is part of the equality check so identical writes are skipped).
- Spaces whose size was never touched keep writing without `panelSizes` (the field
  stays `undefined` on disk → backward compatible). The `remainder` is
  `100 - sidebarPct`; only the sidebar value is authoritative — the workspace
  panel fills the rest, so `panelSizes` is effectively `[sidebarPct,
  100 - sidebarPct]`.

**Global pref as seed only** — `useSidebarPanel` keeps reading
`terax.sidebar.width` for the *initial* `defaultSize` of a brand-new/default space
with no saved `panelSizes`. Once a space has `panelSizes`, it is authoritative for
that space. No migration of the global pref. `toggleSidebar`/`cycleSidebarView`
keep working (pixel-based `resize`/`collapse` interop is fine —
`getSize().asPercentage` is always readable).

**Edge cases:**

- Spaces without `panelSizes`: no resize on switch; the sidebar keeps its current
  width. No surprise jumps for the default space the user never customized.
- Switching from a space with a custom ratio back to an uncustomized one: the
  sidebar stays at the custom ratio (intentional — avoids flapping). The user can
  drag to reset.
- Min/max clamps: `minSize`/`maxSize` px bounds on the panel still enforce
  `SIDEBAR_MIN_WIDTH`/`SIDEBAR_MAX_WIDTH`; percentage resize stays clamped by the
  panel.

## Settings UI

### Trigger

A small gear/edit button added to each `SpaceRow`'s action cluster (the
`[data-no-drag]` zone beside the existing delete/new-tab row actions). Clicking
opens `SpaceSettingsPopover` anchored to that row.

### `SpaceSettingsPopover` (`components/SpaceSettingsPopover.tsx`, new)

Reuses the existing `Popover`/`PopoverTrigger`/`PopoverContent` primitives (same
as `SpaceSwitcher`).

**Fields** (matching the task's "name, root directory, accent color, and startup
commands list"):

- **Name** — text input; commits on Enter/blur via existing `rename`. Inline rename
  in the row stays (both call `rename`); the popover is the fuller editor.
- **Root directory** — text input (lazy: no folder picker for v1); commits via a
  new `setRoot(id, root)` store action. `root` now has a real consumer — it's the
  `cwd` used for startup-command terminals, so editing it matters.
- **Accent color** — a row of `SPACE_COLORS` swatches + a "theme primary" option
  (sets `color: undefined`); commits via existing `setColor`. This is the first UI
  to actually expose `setColor`, which has existed on the store with no input until
  now.
- **Startup commands** — an editable list: a text input + Add button, Enter to
  add, an × on each row to remove; reorder out of scope (YAGNI). Commits live via a
  new `setStartupCommands(id, cmds)` store action. Each entry is a raw shell string
  (`pnpm dev`, `pi`, `cargo run`, etc.) — multi-line allowed, submitted to the PTY
  as-is via `submitToLeaf`'s bracketed-paste path.

### Save model

Stateless: each field writes straight to the `useSpaces` store actions, which
already call `saveSpacesList` (`setColor`/`setEnv` pattern). No "Save" button.
Matches the existing inline-rename commit-as-you-go UX and avoids a duplicate
source of truth.

### New store actions (`lib/useSpaces.ts`)

Mirror `setColor` exactly:

```ts
setRoot: (id: string, root: string | null) => void;
setStartupCommands: (id: string, cmds: string[]) => void;

// implementations:
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
```

## Testing & Verification

### New/extended unit tests (vitest, next to source)

- **`lib/serialize.test.ts`** (extend) — assert `isSerializableTab(tab)` returns
  `false` when `tab.kind === "terminal" && tab.startupCommand !== undefined`, so
  ephemeral tabs never reach `serializeTabs`. Pure function, fast. This is the one
  runnable check for the spec's non-trivial branch.

The hook `useSpaceStartup` itself stays thin (`newTerminalInSpace` + `updateTab` +
`submitToLeaf`); its PTY/timer side-effects are verified by the manual gate below,
not a brittle mock suite.

### No new store-action tests

The existing `setColor` has no test and the new `setRoot`/`setStartupCommands`
are one-line clones of it. YAGNI; the manual gate covers them.

### Verification gates (all must pass clean)

1. `pnpm check-types`
2. `pnpm lint`
3. `pnpm test`
4. `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings` — Rust is
   untouched by this spec (env vars deferred), so this confirms no regression
   rather than new code.
5. `pnpm tauri dev` manual smoke:
   - Create a 2nd space; in its settings popover set
     `startupCommands: ["pnpm dev"]` and drag the sidebar wider.
   - Switch away and back → startup terminal created once, not re-created on the
     second switch.
   - Close the app, relaunch into that space → startup terminal re-created and the
     command re-runs; the sidebar restores to the saved ratio.
   - Switch to the default (uncustomized) space → sidebar stays at the last width,
     no startup terminal spawns.

## File Touch List

- `src/modules/spaces/lib/store.ts` — `SpaceMeta.startupCommands`,
  `SpaceState.panelSizes`.
- `src/modules/spaces/lib/useSpaces.ts` — `setRoot`, `setStartupCommands` actions.
- `src/modules/spaces/lib/useSpaceStartup.ts` (new) — startup/panelSizes lifecycle
  hook.
- `src/modules/spaces/lib/useSpacePersistence.ts` — flush `panelSizes` into
  `SpaceState`; extend `LastWrite` dedupe.
- `src/modules/spaces/lib/serialize.ts` — `isSerializableTab` excludes
  `startupCommand`.
- `src/modules/spaces/lib/serialize.test.ts` — new `startupCommand` exclusion
  case.
- `src/modules/spaces/components/SpaceSettingsPopover.tsx` (new) — settings UI.
- `src/modules/spaces/SpaceSwitcher.tsx` — gear trigger on `SpaceRow`; render
  popover.
- `src/modules/spaces/index.ts` — export `useSpaceStartup`.
- `src/modules/tabs/lib/useTabs.ts` — `TerminalTab.startupCommand`.
- `src/app/App.tsx` — invoke `useSpaceStartup`; thread `activeSidebarPct` into
  `useSpacePersistence`; apply `panelSizes` on switch via `sidebarRef.resize`.

## Risks & Mitigations

- **Startup-terminal attach race** — `submitToLeaf` queues input until the PTY
  attaches (`queuePendingInput`), same mechanism used by `cdInNewTab`. Bounded
  single retry on the leaf ref resolves the remaining race.
- **Sidebar ratio vs. pixel sizing** — percentages are readable from
  `getSize().asPercentage` and `resize` accepts `%` strings; min/max px clamps
  remain enforced by the panel.
- **Repeated disk writes from drag** — already debounced (3s) in
  `useSpacePersistence`; `panelSizes` rides the same flush, so no extra write
  storm.
- **Default space surprise** — uncustomized spaces never resize on switch (no
  `panelSizes`); only spaces the user explicitly widened get a per-space ratio.