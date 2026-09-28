// Each harness's own "pick up the last conversation in this directory" command.
// Only these are ever persisted or typed: an agent without an entry here is
// not offered, and a restored name that is not a key is dropped.
const RESUME_COMMANDS = {
  claude: "claude --continue",
  codex: "codex resume --last",
  opencode: "opencode --continue",
} as const;

export type ResumableAgent = keyof typeof RESUME_COMMANDS;

// A list rather than `in`: an object lookup would accept `toString`.
const RESUMABLE = Object.keys(RESUME_COMMANDS) as ResumableAgent[];

export function isResumableAgent(value: unknown): value is ResumableAgent {
  return typeof value === "string" && (RESUMABLE as string[]).includes(value);
}

export function resumeCommand(agent: ResumableAgent): string {
  return RESUME_COMMANDS[agent];
}
