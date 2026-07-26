// Both surfaces go through their Lazy wrappers: a barrel export of the real
// component would pull the MSE player and control bridge into the eager chunk.
export { DeviceDock } from "./DeviceDockLazy";
export { DeviceDropdown } from "./DeviceDropdownLazy";
export {
  DOCK_DEFAULT_WIDTH,
  DOCK_MAX_WIDTH,
  DOCK_MIN_WIDTH,
  useDeviceDock,
} from "./useDeviceDock";
