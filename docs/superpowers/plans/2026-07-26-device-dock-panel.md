# Device Dock Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full-width `device-preview` workspace tab with a resizable, collapsible panel docked to the right of the workspace, so the device stays visible alongside the terminal.

**Architecture:** Add a third `ResizablePanel` sibling to the existing horizontal `ResizablePanelGroup` in `App.tsx`, peer to the sidebar. A `useDeviceDock` hook mirrors `useSidebarPanel` for width/collapse persistence and holds the single docked serial. `DevicePreviewPane` is retargeted from a tab object to a plain `serial` prop, and the `device-preview` tab kind is deleted outright.

**Tech Stack:** React 19, TypeScript, Tailwind v4, `react-resizable-panels@4.12.2`, Vitest (node environment), Biome.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-26-device-dock-panel-design.md`.
- Dock sizing: default `340px`, min `240px`, max `640px`. Exact values.
- localStorage keys: `terra.deviceDock.width`, `terra.deviceDock.collapsed`. Exact strings.
- The dock holds **exactly one** device. No multi-device switcher.
- The docked device is **not** persisted across restarts. Only width and collapsed state are.
- Collapsing the dock must **not** tear down the scrcpy session.
- **Verified fact — do not re-litigate:** in `react-resizable-panels@4.12.2` the `Panel` component renders `children` unconditionally; collapse is pure flex sizing. Children stay mounted at `collapsedSize={0}`. No `visibility:hidden` fallback is required.
- **Verified fact:** `isSerializableTab` returns `false` for `device-preview` (`src/modules/spaces/lib/serialize.ts:64`), so device tabs were never persisted. No migration path is needed.
- Vitest runs in the **node** environment — there is no DOM and no `localStorage`. Tests stub `globalThis.localStorage`. Component behaviour cannot be asserted; use source-inspection tests as `src/modules/device/useAvds.test.ts` already does.
- Gates that must pass before every commit: `pnpm check-types`, `pnpm test`, `pnpm lint`. `pnpm lint` currently reports **77 warnings** — that is the accepted baseline. Do not increase it.
- Do not add new runtime dependencies.

---

## File Structure

**Create**
- `src/modules/device/useDeviceDock.ts` — dock state: persisted width, persisted collapsed flag, the single docked serial, and the panel imperative ref.
- `src/modules/device/useDeviceDock.test.ts` — persistence and clamping tests, plus the source-inspection guards.
- `src/modules/device/DeviceDock.tsx` — dock chrome: header, `DevicePreviewPane`, `DeviceKeyBar`.

**Modify**
- `src/modules/device/DevicePreviewPane.tsx` — prop `tab: DevicePreviewTab` → `serial: string`.
- `src/modules/device/emptyStates.tsx` — narrow variant on `Shell`.
- `src/modules/device/index.ts` — export surface.
- `src/app/App.tsx` — third panel + wiring.
- `src/app/components/WorkspaceSurface.tsx` — drop the device block.
- `src/modules/tabs/lib/useTabs.ts` — drop the tab kind.
- `src/modules/tabs/lib/tabLabel.ts`, `src/modules/tabs/lib/useWindowTitle.ts`, `src/modules/tabs/index.ts`, `src/modules/spaces/lib/serialize.ts` — drop their `device-preview` branches.

**Delete**
- `src/modules/device/DeviceStack.tsx`

---

### Task 1: `useDeviceDock` state hook

**Files:**
- Create: `src/modules/device/useDeviceDock.ts`
- Test: `src/modules/device/useDeviceDock.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DOCK_DEFAULT_WIDTH = 340`, `DOCK_MIN_WIDTH = 240`, `DOCK_MAX_WIDTH = 640`
  - `clampDockWidth(width: number): number`
  - `readDockWidth(): number`
  - `readDockCollapsed(): boolean`
  - `useDeviceDock(): { dockRef: RefObject<PanelImperativeHandle | null>; dockWidthRef: RefObject<number>; serial: string | null; initialCollapsed: boolean; dockDevice: (serial: string) => void; stopDevice: () => void; persistDockWidth: (next: number) => void; persistDockCollapsed: (collapsed: boolean) => void }`

- [ ] **Step 1: Write the failing test**

Create `src/modules/device/useDeviceDock.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  clampDockWidth,
  DOCK_DEFAULT_WIDTH,
  DOCK_MAX_WIDTH,
  DOCK_MIN_WIDTH,
  readDockCollapsed,
  readDockWidth,
} from "./useDeviceDock";

function stubStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  // Vitest runs in the node environment, so localStorage does not exist.
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
}

describe("clampDockWidth", () => {
  beforeEach(() => stubStorage());

  it("keeps a width already inside the range", () => {
    expect(clampDockWidth(400)).toBe(400);
  });

  it("clamps to the documented bounds", () => {
    expect(clampDockWidth(10)).toBe(DOCK_MIN_WIDTH);
    expect(clampDockWidth(5000)).toBe(DOCK_MAX_WIDTH);
  });

  it("rounds fractional widths from pixel drags", () => {
    expect(clampDockWidth(341.6)).toBe(342);
  });
});

describe("readDockWidth", () => {
  it("falls back to the default when nothing is stored", () => {
    stubStorage();
    expect(readDockWidth()).toBe(DOCK_DEFAULT_WIDTH);
  });

  it("falls back to the default when the stored value is garbage", () => {
    stubStorage({ "terra.deviceDock.width": "not-a-number" });
    expect(readDockWidth()).toBe(DOCK_DEFAULT_WIDTH);
  });

  it("clamps an out-of-range stored width", () => {
    stubStorage({ "terra.deviceDock.width": "9999" });
    expect(readDockWidth()).toBe(DOCK_MAX_WIDTH);
  });

  it("returns a valid stored width", () => {
    stubStorage({ "terra.deviceDock.width": "420" });
    expect(readDockWidth()).toBe(420);
  });
});

describe("readDockCollapsed", () => {
  it("is false by default", () => {
    stubStorage();
    expect(readDockCollapsed()).toBe(false);
  });

  it("is true only for the exact stored flag", () => {
    stubStorage({ "terra.deviceDock.collapsed": "1" });
    expect(readDockCollapsed()).toBe(true);
    stubStorage({ "terra.deviceDock.collapsed": "0" });
    expect(readDockCollapsed()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/modules/device/useDeviceDock.test.ts`
Expected: FAIL — `Failed to resolve import "./useDeviceDock"`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/device/useDeviceDock.ts`:

```ts
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

export const DOCK_DEFAULT_WIDTH = 340;
export const DOCK_MIN_WIDTH = 240;
export const DOCK_MAX_WIDTH = 640;

const DOCK_WIDTH_STORAGE_KEY = "terra.deviceDock.width";
const DOCK_COLLAPSED_STORAGE_KEY = "terra.deviceDock.collapsed";

export function clampDockWidth(width: number): number {
  return Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, Math.round(width)));
}

export function readDockWidth(): number {
  try {
    const stored = window.localStorage.getItem(DOCK_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : Number.NaN;
    return Number.isFinite(parsed) ? clampDockWidth(parsed) : DOCK_DEFAULT_WIDTH;
  } catch {
    return DOCK_DEFAULT_WIDTH;
  }
}

export function readDockCollapsed(): boolean {
  try {
    return window.localStorage.getItem(DOCK_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Dock state, mirroring useSidebarPanel. The docked serial is deliberately not
 * persisted: reconnecting on startup to a device that has since disappeared
 * surfaces an error before the user has done anything.
 */
export function useDeviceDock() {
  const dockRef = useRef<PanelImperativeHandle | null>(null);
  const dockWidthRef = useRef(readDockWidth());
  const widthWriteTimerRef = useRef(0);
  const [serial, setSerial] = useState<string | null>(null);
  const [initialCollapsed] = useState(true);
  const collapsedRef = useRef(true);

  const persistDockCollapsed = useCallback((collapsed: boolean) => {
    if (collapsedRef.current === collapsed) return;
    collapsedRef.current = collapsed;
    try {
      window.localStorage.setItem(DOCK_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      // storage may fail in private mode
    }
  }, []);

  const persistDockWidth = useCallback((next: number) => {
    dockWidthRef.current = next;
    if (widthWriteTimerRef.current) window.clearTimeout(widthWriteTimerRef.current);
    widthWriteTimerRef.current = window.setTimeout(() => {
      widthWriteTimerRef.current = 0;
      try {
        window.localStorage.setItem(DOCK_WIDTH_STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
    }, 200);
  }, []);

  useEffect(() => {
    return () => {
      if (widthWriteTimerRef.current) window.clearTimeout(widthWriteTimerRef.current);
    };
  }, []);

  // Picking the already-docked device just re-expands it, so the live scrcpy
  // session is reused instead of being torn down and restarted.
  const dockDevice = useCallback((next: string) => {
    setSerial(next);
    dockRef.current?.resize(`${dockWidthRef.current}px`);
  }, []);

  const stopDevice = useCallback(() => {
    setSerial(null);
    dockRef.current?.collapse();
  }, []);

  return {
    dockRef,
    dockWidthRef,
    serial,
    initialCollapsed,
    dockDevice,
    stopDevice,
    persistDockWidth,
    persistDockCollapsed,
  };
}

export type UseDeviceDock = ReturnType<typeof useDeviceDock>;
export type DockPanelRef = RefObject<PanelImperativeHandle | null>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/modules/device/useDeviceDock.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the gates**

Run: `pnpm check-types && pnpm lint`
Expected: types clean; lint still reports exactly 77 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/modules/device/useDeviceDock.ts src/modules/device/useDeviceDock.test.ts
git commit -m "feat(device): add useDeviceDock state hook with persisted width and collapse"
```

---

### Task 2: Retarget `DevicePreviewPane` to a plain serial

**Files:**
- Modify: `src/modules/device/DevicePreviewPane.tsx`
- Modify: `src/modules/device/emptyStates.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `DevicePreviewPane({ serial }: { serial: string })`. `Shell` in `emptyStates.tsx` gains an optional `narrow?: boolean` prop.

The pane only ever reads `tab.serial`, so this is a prop rename plus removing the `@/modules/tabs` import.

- [ ] **Step 1: Change the pane's prop**

In `src/modules/device/DevicePreviewPane.tsx`, delete this import line entirely:

```ts
import type { DevicePreviewTab } from "@/modules/tabs";
```

Change the signature from:

```tsx
export function DevicePreviewPane({ tab }: { tab: DevicePreviewTab }) {
```

to:

```tsx
export function DevicePreviewPane({ serial }: { serial: string }) {
```

Then replace every remaining `tab.serial` in the file with `serial`. There are four: the `device_list` match check, the `unauthorized` status, the `device_open` call, and the `device_screen_size` call. Finally change the effect dependency array from `[tab.serial]` to `[serial]`.

- [ ] **Step 2: Add the narrow variant to the shared empty-state shell**

In `src/modules/device/emptyStates.tsx`, replace the `Shell` function with:

```tsx
function Shell({
  title,
  narrow,
  children,
}: {
  title: string;
  narrow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-3 text-center",
        narrow ? "px-3" : "px-6",
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
        <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={1.5} />
      </div>
      <p className="text-[12.5px] font-medium text-foreground">{title}</p>
      <div
        className={cn(
          "leading-relaxed text-muted-foreground",
          // At dock width the install commands in AdbMissing wrap hard; shrink
          // the type and let long tokens break rather than overflow.
          narrow ? "max-w-full text-[11px] break-words" : "max-w-sm text-xs",
        )}
      >
        {children}
      </div>
    </div>
  );
}
```

Add the `cn` import at the top of the file if it is not already present:

```ts
import { cn } from "@/lib/utils";
```

- [ ] **Step 3: Thread `narrow` through the exported states**

Add an optional `narrow?: boolean` prop to `AdbMissing`, `NoDevices`, `UnauthorizedDevice` and `ServerFailed`, and pass it to their `Shell`. For example:

```tsx
export function AdbMissing({ narrow }: { narrow?: boolean }) {
  return (
    <Shell title="adb not found" narrow={narrow}>
```

Do the same for the other three. In `DevicePreviewPane.tsx`, pass `narrow` to each rendered empty state, since the pane now only ever renders inside the dock:

```tsx
if (status.kind === "adb-missing") return <AdbMissing narrow />;
if (status.kind === "no-devices") return <NoDevices narrow onRefresh={() => location.reload()} />;
if (status.kind === "unauthorized")
  return <UnauthorizedDevice narrow serial={status.serial} onRefresh={() => location.reload()} />;
if (status.kind === "error") return <ServerFailed narrow message={status.message} />;
```

- [ ] **Step 4: Verify types**

Run: `pnpm check-types`
Expected: FAIL — `DeviceStack.tsx` still passes `tab={t}`. That is expected; Task 4 deletes it. Confirm the only errors reported are in `DeviceStack.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/device/DevicePreviewPane.tsx src/modules/device/emptyStates.tsx
git commit -m "refactor(device): take a serial prop in DevicePreviewPane and add narrow empty states"
```

---

### Task 3: `DeviceDock` component

**Files:**
- Create: `src/modules/device/DeviceDock.tsx`

**Interfaces:**
- Consumes: `DevicePreviewPane({ serial })` from Task 2; `DeviceKeyBar({ keycodes, disabled, onPress })` and `DEVICE_KEYCODE` from the existing module.
- Produces: `DeviceDock({ serial, onStop }: { serial: string | null; onStop: () => void })`.

- [ ] **Step 1: Write the component**

Create `src/modules/device/DeviceDock.tsx`:

```tsx
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { DeviceKeyBar } from "./DeviceKeyBar";
import { DevicePreviewPane } from "./DevicePreviewPane";
import { DEVICE_KEYCODE, DeviceControlBridge } from "./controlBridge";

type Props = {
  serial: string | null;
  onStop: () => void;
};

/**
 * Right-docked device surface. Renders nothing until a device is picked; the
 * panel itself stays collapsed at zero width until then, so there is no empty
 * state to design.
 *
 * `overflow-hidden` matters: react-resizable-panels sets `overflow: visible`
 * on the panel element, so without it the video would spill over the workspace
 * while the dock is collapsed to zero width.
 */
export function DeviceDock({ serial, onStop }: Props) {
  if (!serial) return null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-border/60 bg-card">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-2">
        <span className="truncate text-[11px] font-medium text-foreground" title={serial}>
          {serial}
        </span>
        <button
          type="button"
          onClick={onStop}
          title="Stop and close this device"
          aria-label="Stop and close this device"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
        </button>
      </div>

      <div className="min-h-0 flex-1">
        <DevicePreviewPane serial={serial} />
      </div>
    </div>
  );
}
```

Note: `DeviceKeyBar` is rendered by `DevicePreviewPane` already (added in the previous session), so the dock does not render it a second time. Remove the unused imports `DeviceKeyBar`, `DEVICE_KEYCODE` and `DeviceControlBridge` from the file — they are listed above only to make the dependency explicit. The final import block is:

```tsx
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { DevicePreviewPane } from "./DevicePreviewPane";
```

- [ ] **Step 2: Verify types and lint**

Run: `pnpm check-types && pnpm lint`
Expected: types still fail only in `DeviceStack.tsx` (deleted in Task 4); lint at 77 warnings.

- [ ] **Step 3: Commit**

```bash
git add src/modules/device/DeviceDock.tsx
git commit -m "feat(device): add DeviceDock chrome with serial header and stop control"
```

---

### Task 4: Mount the dock in `App.tsx` and delete `DeviceStack`

**Files:**
- Modify: `src/app/App.tsx:1058-1156`
- Modify: `src/modules/device/index.ts`
- Delete: `src/modules/device/DeviceStack.tsx`

**Interfaces:**
- Consumes: `useDeviceDock()` (Task 1), `DeviceDock` (Task 3).
- Produces: the dock is live and pickable from the Devices sidebar.

- [ ] **Step 1: Delete the old stack**

```bash
git rm src/modules/device/DeviceStack.tsx
```

- [ ] **Step 2: Update the module barrel**

Replace `src/modules/device/index.ts` with:

```ts
export { DeviceDock } from "./DeviceDock";
export { DeviceDropdown } from "./DeviceDropdown";
export { DevicePreviewPane } from "./DevicePreviewPane";
export { DeviceControlBridge, scaleCoordinates, DEVICE_KEYCODE } from "./controlBridge";
export { useDeviceDock } from "./useDeviceDock";
```

- [ ] **Step 3: Wire the hook into `App.tsx`**

Add to the imports from `@/modules/device` (the existing import of `DeviceDropdown`):

```ts
import { DeviceDock, DeviceDropdown, useDeviceDock } from "@/modules/device";
```

Add the hook call alongside the other hook calls in the `App` component body, near `useSidebarPanel`:

```ts
const {
  dockRef,
  dockWidthRef,
  serial: dockedSerial,
  initialCollapsed: dockInitialCollapsed,
  dockDevice,
  stopDevice,
  persistDockWidth,
  persistDockCollapsed,
} = useDeviceDock();
```

- [ ] **Step 4: Point the Devices sidebar at the dock**

At `src/app/App.tsx:1113`, change:

```tsx
<DeviceDropdown onPick={(serial) => newDevicePreviewTab(serial)} />
```

to:

```tsx
<DeviceDropdown onPick={(serial) => dockDevice(serial)} />
```

- [ ] **Step 5: Add the panel**

Immediately after the closing `</ResizablePanel>` of the `workspace` panel (`src/app/App.tsx:1155`) and before `</ResizablePanelGroup>`, insert:

```tsx
<ResizableHandle withHandle />
<ResizablePanel
  id="device-dock"
  panelRef={dockRef}
  defaultSize={dockInitialCollapsed ? "0px" : `${dockWidthRef.current}px`}
  minSize={`${DOCK_MIN_WIDTH}px`}
  maxSize={`${DOCK_MAX_WIDTH}px`}
  collapsible
  collapsedSize={0}
  onResize={(size) => {
    if (size.inPixels > 0) persistDockWidth(size.inPixels);
    persistDockCollapsed(size.inPixels <= 0);
  }}
>
  <DeviceDock serial={dockedSerial} onStop={stopDevice} />
</ResizablePanel>
```

The panel needs `DOCK_MIN_WIDTH` and `DOCK_MAX_WIDTH`. Export them from the
barrel by replacing the `useDeviceDock` line in `src/modules/device/index.ts`
(added in Step 2) with:

```ts
export {
  DOCK_DEFAULT_WIDTH,
  DOCK_MAX_WIDTH,
  DOCK_MIN_WIDTH,
  useDeviceDock,
} from "./useDeviceDock";
```

Then the `App.tsx` import from Step 3 becomes, in full:

```ts
import {
  DeviceDock,
  DeviceDropdown,
  DOCK_MAX_WIDTH,
  DOCK_MIN_WIDTH,
  useDeviceDock,
} from "@/modules/device";
```

- [ ] **Step 6: Run the gates**

Run: `pnpm check-types && pnpm test && pnpm lint`
Expected: types clean (the `DeviceStack` errors from Tasks 2–3 are resolved by its deletion); tests pass; lint at 77 warnings.

- [ ] **Step 7: Commit**

```bash
git add -A src/app/App.tsx src/modules/device/
git commit -m "feat(device): dock the device preview as a resizable right panel"
```

---

### Task 5: Delete the `device-preview` tab kind

**Files:**
- Modify: `src/app/components/WorkspaceSurface.tsx`
- Modify: `src/modules/tabs/lib/useTabs.ts`
- Modify: `src/modules/tabs/lib/tabLabel.ts`
- Modify: `src/modules/tabs/lib/useWindowTitle.ts`
- Modify: `src/modules/tabs/index.ts`
- Modify: `src/modules/spaces/lib/serialize.ts`
- Test: `src/modules/device/useDeviceDock.test.ts`

**Interfaces:**
- Consumes: the dock from Task 4 is the only device surface.
- Produces: no `device-preview` string anywhere outside this plan's own docs.

- [ ] **Step 1: Write the failing guard tests**

Append to `src/modules/device/useDeviceDock.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

describe("the dock is the only device surface", () => {
  // Two mount sites racing over one scrcpy session is the failure this
  // refactor could reintroduce, and it would not surface as a type error.
  // `--exclude` is load-bearing: these patterns are string literals in THIS
  // file, which lives under src/, so an unfiltered grep matches itself and the
  // assertion can never pass.
  it("mounts DevicePreviewPane in exactly one place", () => {
    const hits = execSync(
      "grep -rl '<DevicePreviewPane' src/ --exclude=useDeviceDock.test.ts || true",
      { cwd: repoRoot, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
    expect(hits).toEqual(["src/modules/device/DeviceDock.tsx"]);
  });

  it("has no device-preview tab kind left in the codebase", () => {
    const hits = execSync(
      "grep -rn 'device-preview\\|DevicePreviewTab\\|newDevicePreviewTab' src/ --exclude=useDeviceDock.test.ts || true",
      { cwd: repoRoot, encoding: "utf8" },
    ).trim();
    expect(hits).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/modules/device/useDeviceDock.test.ts`
Expected: FAIL — the second test lists the remaining `device-preview` references.

- [ ] **Step 3: Remove the surface from `WorkspaceSurface.tsx`**

Delete the `DeviceStack` import (line 3), the `isDevicePreviewTab` constant (line 65), and the entire final `<div>` block that renders `<DeviceStack …>` (lines 152–160).

- [ ] **Step 4: Remove the tab kind from `useTabs.ts`**

- Delete the `DevicePreviewTab` type (lines 104–110).
- Remove `| DevicePreviewTab` from the `Tab` union (line 120).
- Delete the whole `newDevicePreviewTab` callback (lines 583–597).
- Delete `newDevicePreviewTab,` from the hook's return object (line 1111).
- Delete the `deviceHandle` teardown block:

```ts
if (target?.kind === "device-preview" && target.deviceHandle != null) {
  void invoke("device_close", { handle: target.deviceHandle }).catch(
    () => {},
  );
}
```

- Delete the line `if (x.kind === "device-preview") return x;` (line 876).
- If `invoke` is now unused in the file, remove its import. Verify with `pnpm lint`.

- [ ] **Step 5: Remove the remaining branches**

- `src/modules/tabs/lib/tabLabel.ts`: delete `if (t.kind === "device-preview") return t.serial;`
- `src/modules/tabs/lib/useWindowTitle.ts`: delete `if (tab.kind === "device-preview") return tab.serial;`
- `src/modules/tabs/index.ts`: delete `type DevicePreviewTab,` from the export list.
- `src/modules/spaces/lib/serialize.ts`: delete the `case "device-preview": return false;` arm from `isSerializableTab`. The `default: return false;` arm already covers every non-serializable kind, so behaviour is unchanged.

- [ ] **Step 6: Remove the now-dead call in `App.tsx`**

Delete `newDevicePreviewTab,` from the destructured `useTabs()` result (line 117).

- [ ] **Step 7: Run the gates**

Run: `pnpm check-types && pnpm test && pnpm lint`
Expected: all clean; both guard tests pass; lint at 77 warnings.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(tabs): remove the device-preview tab kind now the dock owns devices"
```

---

### Task 6: Verify against a live emulator

**Files:** none — manual verification.

**Interfaces:**
- Consumes: everything above.
- Produces: confirmation of the one behaviour the test suite cannot cover.

The node-environment test suite has no DOM, so none of the dock's runtime behaviour is covered. This task is the real gate.

- [ ] **Step 1: Boot an emulator**

```bash
~/Android/Sdk/emulator/emulator -avd Pixel_API34 -port 5554 -no-window -no-boot-anim -no-audio &
until [ "$(~/Android/Sdk/platform-tools/adb -s emulator-5554 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done; echo booted
```

- [ ] **Step 2: Run the app**

Run: `pnpm tauri dev`

- [ ] **Step 3: Check the dock appears and streams**

Open the Devices panel in the sidebar (the third rail button), pick `emulator-5554`.
Expected: the dock expands on the right at 340px and the device streams.

- [ ] **Step 4: Check touch still lands in the narrower column**

Tap an app icon and swipe up from the bottom edge.
Expected: the tap activates and the swipe triggers the Home gesture. This exercises the letterbox mapping at a different aspect ratio than the tab had.

- [ ] **Step 5: Check collapse keeps the session alive — the flagged risk**

Drag the dock's handle left past its minimum to collapse it. Wait ~15 seconds. Drag it back open.
Expected: the stream is still live (not black, not reconnecting) and touch still lands.
If the stream died, `collapsedSize={0}` is unmounting children after all — apply the spec's fallback: keep `DeviceDock` always mounted and hide it with `visibility: hidden` instead of relying on panel collapse.

- [ ] **Step 6: Check width and collapse persist**

Resize the dock, quit the app, relaunch.
Expected: the dock reopens at the same width, and no device is docked (deliberate — the serial is not persisted).

- [ ] **Step 7: Check Stop**

Pick a device, then click the header's stop button.
Expected: the dock collapses, the serial clears, and `adb devices` shows the emulator still running (Stop ends the scrcpy session, not the emulator).

- [ ] **Step 8: Clean up**

```bash
~/Android/Sdk/platform-tools/adb -s emulator-5554 emu kill
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| Layout — third `ResizablePanel` sibling | 4 |
| `DeviceDock.tsx` | 3 |
| `useDeviceDock.ts` | 1 |
| `DevicePreviewPane` takes `serial` | 2 |
| Devices sidebar `onPick` → `dockDevice` | 4 |
| Delete `DeviceStack.tsx` | 4 |
| Delete tab kind + all branches | 5 |
| No migration needed (verified) | 5, Step 5 |
| Session lifecycle table | 1 (`dockDevice`/`stopDevice`), 6 (verification) |
| Known risk — collapse keeps children mounted | Resolved in Global Constraints; verified in 6, Step 5 |
| Visibility model — no empty state, auto-expand | 1 (`dockDevice` resizes), 3 (`if (!serial) return null`) |
| Sizing 340/240/640 + localStorage keys | 1 |
| Device not persisted | 1 (state only, never written) |
| Error handling — narrow empty states | 2 |
| Testing — persistence, single mount site, no kind left | 1, 5 |
| Requires live emulator | 6 |

No gaps.

**Placeholder scan:** No TBD/TODO. Every code step carries real code. Task 6's steps are manual actions with explicit expected outcomes rather than code, which is correct for a verification task.

**Type consistency:** `dockDevice`/`stopDevice`/`persistDockWidth`/`persistDockCollapsed`/`dockRef`/`dockWidthRef`/`initialCollapsed` are named identically in Task 1's `Produces` block, its implementation, and Task 4's destructure. `DevicePreviewPane({ serial })` matches between Task 2's definition and Task 3's use. `DeviceDock({ serial, onStop })` matches between Task 3 and Task 4. `DOCK_MIN_WIDTH`/`DOCK_MAX_WIDTH` are exported in Task 1 and imported in Task 4.

One inconsistency found and fixed inline: Task 3 originally imported `DeviceKeyBar` and `DEVICE_KEYCODE`, but `DevicePreviewPane` already renders the key bar — importing them into the dock would have double-rendered it. Step 1 now states the final import block explicitly.
