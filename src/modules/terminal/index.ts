export { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";
export { TerminalStack } from "./TerminalStack";
export {
  clearFocusedTerminal,
  disposeSession,
  leafHasForegroundProcess,
  leafIdForPty,
  persistedScrollback,
  ptyIdForLeaf,
  respawnSession,
  whenSessionReady,
} from "./lib/useTerminalSession";
export {
  type AgentTabStatus,
  tabAgentStatus,
  useAgentActivityStore,
} from "./lib/agentActivity";
export { useTerminalFileDrop } from "./lib/useTerminalFileDrop";
export { useTerminalDropStore } from "./lib/dropStore";
export { pasteIntoLeaf } from "./lib/rendererPool";
export { formatDroppedPaths } from "./lib/quoteShellPath";
export { configureTerminalLinks } from "./lib/linkDeps";
export { stashRestoredScrollback } from "./lib/scrollbackPersist";
export {
  findLeafCwd,
  hasLeaf,
  isLeaf,
  leafIds,
  type PaneBounds,
  type PaneId,
  type PaneNode,
  type SplitDir,
} from "./lib/panes";
