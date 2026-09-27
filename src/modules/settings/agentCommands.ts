// Mirrors `is_safe_agent_name` and the caps in `pty/agent_detect.rs`, which
// re-validates on every pty_open: this copy only shapes what the UI accepts.
export const MAX_AGENT_COMMANDS = 16;
const AGENT_COMMAND = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

export const BUILTIN_AGENT_COMMANDS = ["claude", "codex", "opencode"] as const;

export function isAgentCommand(name: string): boolean {
  return AGENT_COMMAND.test(name);
}

/** Split typed text on commas and whitespace into accepted and refused names.
 * Built-ins and repeats are dropped silently; past the cap names are refused. */
export function parseAgentCommands(text: string): {
  accepted: string[];
  refused: string[];
} {
  const accepted: string[] = [];
  const refused: string[] = [];
  for (const token of text.split(/[\s,]+/)) {
    if (!token) continue;
    if (!isAgentCommand(token) || accepted.length === MAX_AGENT_COMMANDS) {
      refused.push(token);
      continue;
    }
    if (
      (BUILTIN_AGENT_COMMANDS as readonly string[]).includes(token) ||
      accepted.includes(token)
    )
      continue;
    accepted.push(token);
  }
  return { accepted, refused };
}

/** What a stored value is worth: a valid list, whatever the store held. */
export function normalizeAgentCommands(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names = value.filter(
    (v): v is string => typeof v === "string" && isAgentCommand(v),
  );
  return parseAgentCommands(names.join(" ")).accepted;
}
