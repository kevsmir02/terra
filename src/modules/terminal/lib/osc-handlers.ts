import type { IMarker, Terminal } from "@xterm/xterm";

const MAX_OSC52_CLIPBOARD_BYTES = 1024 * 1024;

/**
 * Cross-handler state shared between the OSC 7 cwd handler and the OSC 133
 * prompt-marker handler. Tracks whether we are currently inside a running
 * command (between OSC 133 B and the next OSC 133 D / A), so the cwd handler
 * can ignore OSC 7 updates emitted by *command output* (e.g. a remote SSH
 * server, a `cat` of an attacker-controlled file). Only OSC 7 issued by the
 * local shell, which fires between commands, should be honored.
 */
export type ShellIntegrationState = {
  inCommand: boolean;
};

export function createShellIntegrationState(): ShellIntegrationState {
  return { inCommand: false };
}

export function registerCwdHandler(
  term: Terminal,
  onCwd: (cwd: string) => void,
  state?: ShellIntegrationState,
): () => void {
  const d = term.parser.registerOscHandler(7, (data) => {
    // Reject OSC 7 emitted while a command is running: command stdout/stderr
    // is untrusted (it can come from a remote shell, an SSH session, a `cat`
    // of attacker-controlled bytes). The local shell only emits OSC 7
    // between commands via its precmd/PROMPT_COMMAND hook.
    if (state?.inCommand) return true;
    const cwd = parseOsc7(data);
    if (cwd) onCwd(cwd);
    return true;
  });
  return () => d.dispose();
}

export type PromptTracker = {
  getMarker: () => IMarker | null;
  /** Buffer line of every prompt still in the buffer, oldest first. */
  commandLines: () => number[];
  /** Line markers of the last command's output: C to D, D null while running. */
  lastOutput: () => { start: number | null; end: number | null };
  dispose: () => void;
};

const MAX_PROMPT_MARKERS = 500;

export function registerPromptTracker(
  term: Terminal,
  state?: ShellIntegrationState,
  // Fires on C (process executing) and A/D (back at prompt). Distinct from
  // inCommand, which is already true from B while the user merely types.
  onCommandState?: (running: boolean) => void,
): PromptTracker {
  let marker: IMarker | null = null;
  const prompts: IMarker[] = [];
  let outputStart: IMarker | null = null;
  let outputEnd: IMarker | null = null;
  const d = term.parser.registerOscHandler(133, (data) => {
    // OSC 133 A: start of new prompt (between commands).
    if (data.startsWith("A")) {
      if (state) state.inCommand = false;
      onCommandState?.(false);
      marker = term.registerMarker(0) ?? null;
      if (marker) prompts.push(marker);
      if (prompts.length > MAX_PROMPT_MARKERS) prompts.shift()?.dispose();
    } else if (data.startsWith("B")) {
      // OSC 133 B: command begins. From here on, treat all output as
      // untrusted until we see D (command exit) or the next A (new prompt).
      if (state) state.inCommand = true;
    } else if (data.startsWith("C")) {
      // OSC 133 C: command pre-execution marker; still inside command.
      if (state) state.inCommand = true;
      onCommandState?.(true);
      outputStart?.dispose();
      outputEnd?.dispose();
      outputEnd = null;
      outputStart = term.registerMarker(0) ?? null;
    } else if (data.startsWith("D")) {
      // OSC 133 D: command ends.
      if (state) state.inCommand = false;
      onCommandState?.(false);
      outputEnd?.dispose();
      outputEnd = term.registerMarker(0) ?? null;
    }
    return true;
  });
  const lineOf = (m: IMarker | null) => (m && !m.isDisposed ? m.line : null);
  return {
    getMarker: () => (marker && !marker.isDisposed ? marker : null),
    commandLines: () =>
      prompts.filter((m) => !m.isDisposed).map((m) => m.line),
    lastOutput: () => ({ start: lineOf(outputStart), end: lineOf(outputEnd) }),
    dispose: () => {
      d.dispose();
      for (const m of prompts) m.dispose();
      prompts.length = 0;
      outputStart?.dispose();
      outputEnd?.dispose();
      outputStart = null;
      outputEnd = null;
      marker = null;
    },
  };
}

export type ClipboardWriter = (text: string) => void | Promise<void>;

export function registerOsc52ClipboardHandler(
  term: Terminal,
  writeClipboard: ClipboardWriter = writeSystemClipboard,
): () => void {
  const d = term.parser.registerOscHandler(52, (data) => {
    const text = parseOsc52Clipboard(data);
    if (text === null) return true;
    queueMicrotask(() => {
      try {
        void Promise.resolve(writeClipboard(text)).catch(() => {});
      } catch {}
    });
    return true;
  });
  return () => d.dispose();
}

function parseOsc7(data: string): string | null {
  const m = data.match(/^file:\/\/[^/]*(\/.*)$/);
  if (!m) return null;
  let path = m[1];
  try {
    path = decodeURIComponent(path);
  } catch {}
  return path;
}

function parseOsc52Clipboard(data: string): string | null {
  const parts = data.split(";");
  if (parts.length < 2) return null;
  const selection = parts[0] || "c";
  if (!selection.includes("c")) return null;
  const encoded = parts.slice(1).join(";");
  if (!encoded || encoded === "?") return null;
  if (encoded.length > Math.ceil((MAX_OSC52_CLIPBOARD_BYTES * 4) / 3) + 4) {
    return null;
  }
  const compact = encoded.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) return null;

  try {
    const bytes = Uint8Array.from(atob(compact), (c) => c.charCodeAt(0));
    if (bytes.byteLength > MAX_OSC52_CLIPBOARD_BYTES) return null;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function writeSystemClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
