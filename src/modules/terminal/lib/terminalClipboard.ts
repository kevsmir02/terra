// WebKitGTK can't read external copies, so go through the native plugin first
// and fall back to the web clipboard.
function webClipboard(): Clipboard | null {
  if (typeof navigator === "undefined") return null;
  return navigator.clipboard ?? null;
}

export async function readTerminalClipboard(): Promise<string> {
  try {
    const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
    return await readText();
  } catch {}
  try {
    return (await webClipboard()?.readText()) ?? "";
  } catch {
    return "";
  }
}

/** Resolves true when the text actually reached the clipboard. Callers that
 *  only fire-and-forget can keep ignoring the result; callers that report
 *  success to the user must not claim it on a silently failed write. */
export async function writeTerminalClipboard(text: string): Promise<boolean> {
  try {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
    return true;
  } catch {}
  try {
    const clipboard = webClipboard();
    if (!clipboard) return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
