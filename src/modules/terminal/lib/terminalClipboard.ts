// WebKitGTK can't read external copies, so the native plugin is Linux-only and
// lazy-loaded to keep it out of the mac/win bundle.
const IS_LINUX =
  typeof navigator !== "undefined" &&
  /Linux/.test(navigator.userAgent) &&
  !/Android/.test(navigator.userAgent);

function webClipboard(): Clipboard | null {
  if (typeof navigator === "undefined") return null;
  return navigator.clipboard ?? null;
}

export async function readTerminalClipboard(): Promise<string> {
  if (IS_LINUX) {
    try {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      return await readText();
    } catch {}
  }
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
  if (IS_LINUX) {
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return true;
    } catch {}
  }
  try {
    const clipboard = webClipboard();
    if (!clipboard) return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
