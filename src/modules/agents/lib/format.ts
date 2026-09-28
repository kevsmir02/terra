const LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  gemini: "Gemini CLI",
  aider: "Aider",
  amp: "Amp",
  "cursor-agent": "Cursor Agent",
  qwen: "Qwen Code",
  terra: "Terra",
  shell: "Terminal",
};

export function displayAgent(agent: string): string {
  if (!agent) return "Agent";
  return (
    LABELS[agent.toLowerCase()] ??
    agent.charAt(0).toUpperCase() + agent.slice(1)
  );
}
