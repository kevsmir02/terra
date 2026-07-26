# Device Dock Panel — Design

**Date:** 2026-07-26
**Status:** Approved, ready for implementation planning

## Problem

The device preview opens as a `device-preview` workspace tab. A tab is full-width
and mutually exclusive with every other tab, so watching the device means not
seeing the terminal or editor — the user switches back and forth. That is the
same alt-tabbing the streaming feature exists to remove; the tab form defeats
the feature's purpose.

The device should be a persistent column beside the workspace, visible at the
same time as the terminal.

## Goals

- Device preview docked to the right of the workspace, resizable and collapsible.
- Visible simultaneously with any workspace tab.
- One place a device can ever live — no duplicate surfaces.

## Non-goals

- Multiple devices docked at once. The dock holds exactly one.
- A separate OS window / pop-out. Considered and rejected: a real window can be
  lost behind others, reintroducing the alt-tabbing this removes.
- Persisting or auto-reconnecting the docked device across app restarts.
- A keyboard shortcut for the dock. Trivial to add later via the existing
  `shortcuts` module; not needed for the first version.

## Layout

Add the dock as a third `ResizablePanel` sibling in the existing horizontal
group in `App.tsx`:

```
ResizablePanelGroup (horizontal)
├─ ResizablePanel  #sidebar       collapsible   (unchanged)
├─ ResizableHandle
├─ ResizablePanel  #workspace                   (unchanged)
├─ ResizableHandle                              NEW
└─ ResizablePanel  #device-dock   collapsible   NEW
```

The dock is a peer of the sidebar, so resize, collapse, and width persistence
follow the pattern `useSidebarPanel` already establishes, and the drag handles
behave identically on both edges.

### Alternatives considered

- **Nested `ResizablePanelGroup` inside `#workspace`.** Adds a second group for
  no benefit, and places the dock above `WorkspaceInputBar` instead of spanning
  the full height.
- **Absolutely-positioned overlay.** No resize plumbing, but it covers content
  and cannot be a peer of the sidebar. Wrong for a persistent surface.

## Components

### New

- **`src/modules/device/DeviceDock.tsx`** — dock chrome. Header showing the
  device serial with a Stop control; `DevicePreviewPane` filling the middle;
  `DeviceKeyBar` pinned to the bottom.
- **`src/modules/device/useDeviceDock.ts`** — mirrors `useSidebarPanel`:
  `panelRef`, persisted width, persisted collapsed state, and the single docked
  serial.

### Changed

- **`DevicePreviewPane`** — takes `serial: string` instead of
  `tab: DevicePreviewTab`. It only ever reads `tab.serial`, so this is a prop
  rename plus a type change.
- **`App.tsx`** — the Devices sidebar's `onPick` calls `dockDevice(serial)`,
  returned by `useDeviceDock`, instead of `newDevicePreviewTab(serial)`.
  `dockDevice` sets the docked serial and expands the panel.

### Deleted

- `src/modules/device/DeviceStack.tsx`
- `DevicePreviewTab` type, its union member, and `newDevicePreviewTab`
  (`tabs/lib/useTabs.ts`)
- The `device-preview` branch in `WorkspaceSurface.tsx`
- The `device-preview` branches in `tabs/lib/tabLabel.ts` and
  `tabs/lib/useWindowTitle.ts`
- The `deviceHandle` teardown at `tabs/lib/useTabs.ts:833` — superseded by the
  dock's pane-unmount lifecycle
- The `device-preview` case in `spaces/lib/serialize.ts`

**No migration is required.** `isSerializableTab` returns `false` for
`device-preview` (`serialize.ts:64`), so device tabs have never been persisted.
No saved space can contain one, so removing the kind cannot break restore.

## Session lifecycle

`DevicePreviewPane` already opens a handle on mount and closes it on unmount,
keyed by serial. The lifecycle therefore falls out of mount discipline rather
than new bookkeeping:

| Action | Behaviour |
|---|---|
| Pick a device | Pane mounts with that serial → `device_open` |
| Pick a different device | Serial changes → old handle closed, new opened |
| Collapse the dock | **Session stays alive** — view toggle only |
| Stop (dock header) | Pane unmounts → `device_close`, dock collapses, serial cleared |
| App exit | Already covered by `DeviceState::kill_all()` |

### Known risk

Keeping the session alive across a collapse depends on `collapsedSize={0}`
leaving children **mounted**. If `react-resizable-panels` unmounts at zero size,
collapsing would silently tear down the scrcpy session and the stream.

This must be verified before building on it. If it does not hold, the fallback
is an always-mounted pane hidden with `visibility: hidden`, matching how
`WorkspaceSurface` already keeps tab surfaces alive.

## Visibility model

The dock has no empty state. It sits collapsed at zero width until a device is
picked, and auto-expands when one is. Picking the already-docked device
re-expands it without restarting the session.

Collapsing is done by dragging the dock's `ResizableHandle` past its minimum,
the same gesture the sidebar already uses — no extra button. Stop, in the dock
header, is the separate action that ends the session rather than just hiding it.

This avoids inventing a placeholder UI and a dedicated toggle affordance.

## Sizing and persistence

- Default `340px`, min `240px`, max `640px`. A phone is roughly 0.45 aspect, so
  340px shows the whole device with modest side bars. Letterboxing is harmless:
  `scaleCoordinates` accounts for `object-contain` bars.
- `terra.deviceDock.width` and `terra.deviceDock.collapsed` in `localStorage`,
  mirroring the sidebar's keys.
- The docked device is deliberately **not** persisted. Auto-reconnecting on
  startup to a device that has since disappeared surfaces a confusing error
  before the user has done anything.

## Error handling

`DevicePreviewPane` renders `AdbMissing`, `NoDevices`, `UnauthorizedDevice` and
`ServerFailed` full-pane. These are centred prose blocks containing `<code>`
spans — `AdbMissing` lists three install commands — and will wrap badly at
340px. Give the shared `Shell` in `emptyStates.tsx` a narrow variant so a docked
error state stays legible.

## Testing

Consistent with how this module is already tested: pure logic plus source
inspection. The repo has no React testing library, so component behaviour cannot
be asserted directly.

- `useDeviceDock` persistence: width clamping to `[240, 640]`, `localStorage`
  round-trip, collapsed flag.
- A source test asserting `DevicePreviewPane` is mounted in exactly **one**
  place. Two mount sites racing over a single scrcpy session is the failure mode
  this refactor could reintroduce, and it would not surface as a type error.
- A source test asserting no `device-preview` string survives outside the
  deleted files, proving the removal is complete.

### Requires a live emulator

That collapsing the dock keeps the session alive — the risk noted above. Manual
check against a running emulator: collapse, wait, expand, confirm the stream is
still live and touch still lands.
