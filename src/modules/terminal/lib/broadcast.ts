export type BroadcastCandidate = {
  leafId: number;
  /** The shell is running and can take input. */
  alive: boolean;
  /** An agent harness is running in the leaf right now. */
  agent: boolean;
};

/** Leaves that take the line, in tree order. An exited shell never does. */
export function broadcastRecipients(
  candidates: readonly BroadcastCandidate[],
  agentsOnly: boolean,
): number[] {
  return candidates
    .filter((c) => c.alive && (!agentsOnly || c.agent))
    .map((c) => c.leafId);
}

/**
 * The text to type before Enter, or null when there is nothing to send.
 * Trailing line breaks are the caller's Enter, not part of the line.
 */
export function broadcastLine(text: string): string | null {
  const line = text.replace(/[\r\n]+$/, "");
  return line.trim() === "" ? null : line;
}

/** One line saying who takes the text, or why nobody does. */
export function describeBroadcastTargets(
  candidates: readonly BroadcastCandidate[],
  recipients: readonly number[],
  agentsOnly: boolean,
): string {
  const panes = candidates.length;
  if (panes === 0) return "The active tab is not a terminal.";
  if (!candidates.some((c) => c.alive))
    return panes === 1
      ? "This pane's shell has exited."
      : "Every pane's shell has exited.";
  if (recipients.length === 0)
    return "No pane in this tab is running an agent.";
  const noun = panes === 1 ? "pane" : "panes";
  if (recipients.length === panes) return `Sends to all ${panes} ${noun}.`;
  const which = agentsOnly ? "running an agent" : "still running";
  return `Sends to ${recipients.length} of ${panes} ${noun}, the ones ${which}.`;
}
