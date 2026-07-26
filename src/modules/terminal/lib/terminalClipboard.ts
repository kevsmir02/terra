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

export async function writeTerminalClipboard(text: string): Promise<void> {
  // TEMP-COS-DEBUG
  console.log("[cos] write called", { len: text.length, isLinux: IS_LINUX });
  if (IS_LINUX) {
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      console.log("[cos] write OK via tauri plugin"); // TEMP-COS-DEBUG
      return;
    } catch (err) {
      console.log("[cos] tauri plugin write FAILED", err); // TEMP-COS-DEBUG
    }
  }
  try {
    await webClipboard()?.writeText(text);
    console.log("[cos] write OK via navigator.clipboard", {
      hadClipboard: !!webClipboard(),
    }); // TEMP-COS-DEBUG
  } catch (err) {
    console.log("[cos] navigator.clipboard write FAILED", err); // TEMP-COS-DEBUG
  }
}
