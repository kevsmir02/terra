// Mirrors `is_safe_agent_name` and the caps in `pty/agent_detect.rs`, which
// re-validates on every pty_open: this copy only shapes what the UI keeps.
export const MAX_AGENT_COMMANDS = 16;
const AGENT_COMMAND = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

export const BUILTIN_AGENT_COMMANDS = ["claude", "codex", "opencode"] as const;

export function isAgentCommand(name: string): boolean {
  return AGENT_COMMAND.test(name);
}

/** Folds names into a valid list: plain command names only, no built-ins or
 * repeats, at most the cap. `refused` collects what did not fit. */
export function addAgentCommands(
  into: string[],
  names: readonly unknown[],
  refused?: string[],
): string[] {
  const out = [...into];
  for (const v of names) {
    if (typeof v !== "string" || !v) continue;
    if ((BUILTIN_AGENT_COMMANDS as readonly string[]).includes(v)) continue;
    if (out.includes(v)) continue;
    if (!isAgentCommand(v) || out.length >= MAX_AGENT_COMMANDS)
      refused?.push(v);
    else out.push(v);
  }
  return out;
}

/** What a stored value is worth: a valid list, whatever the store held. */
export function normalizeAgentCommands(value: unknown): string[] {
  return Array.isArray(value) ? addAgentCommands([], value) : [];
}
