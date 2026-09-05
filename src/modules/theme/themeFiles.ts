import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { appConfigDir, join } from "@tauri-apps/api/path";
import type { Theme } from "./types";
import { validateTheme, type ValidationResult } from "./validateTheme";

const THEME_FILE_EXT = ".terra-theme";
// Pre-rename extension. Only ever read: themes exported before the rename must
// still open, but new ones are written as .terra-theme.
const LEGACY_THEME_FILE_EXT = ".terax-theme";
const THEME_EDIT_EVENT = "terra://theme-edit";

export type ThemeEditRequest =
  | { action: "create" }
  | { action: "edit"; id: string };

export function isThemeFilePath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith(THEME_FILE_EXT) || lower.endsWith(LEGACY_THEME_FILE_EXT)
  );
}

async function themesDir(): Promise<string> {
  return join(await appConfigDir(), "themes");
}

export async function themeFilePath(id: string): Promise<string> {
  return join(await themesDir(), `${id}${THEME_FILE_EXT}`);
}

export async function writeThemeFile(theme: Theme): Promise<string> {
  const dir = await themesDir();
  const dirExists = await invoke("fs_stat", { path: dir })
    .then(() => true)
    .catch(() => false);
  if (!dirExists) {
    await invoke("fs_create_dir", { path: dir });
  }
  const path = await join(dir, `${theme.id}${THEME_FILE_EXT}`);
  await invoke("fs_write_file", {
    path,
    content: JSON.stringify(theme, null, 2),
    source: "theme",
  });
  return path;
}

export async function deleteThemeFile(id: string): Promise<void> {
  try {
    const path = await themeFilePath(id);
    await invoke("fs_delete", { path });
  } catch {
    /* file may not exist yet — nothing to clean up */
  }
}

export function parseThemeFile(text: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      diagnostics: [{ severity: "error", path: "", message: e instanceof Error ? e.message : "invalid JSON" }],
    };
  }
  return validateTheme(parsed);
}

export function starterTheme(): Theme {
  const id = `my-theme-${crypto.randomUUID().slice(0, 8)}`;
  return {
    id,
    name: "My Theme",
    description: "Custom theme.",
    variants: {
      dark: {
        colors: {
          background: "#0d0d10",
          foreground: "#e8e8ea",
          card: "#15151a",
          cardForeground: "#e8e8ea",
          popover: "#15151a",
          popoverForeground: "#e8e8ea",
          primary: "#7dd3fc",
          primaryForeground: "#0d0d10",
          muted: "#1c1c22",
          mutedForeground: "#a0a0a8",
          accent: "#1c1c22",
          accentForeground: "#e8e8ea",
          border: "rgba(255,255,255,0.08)",
          input: "rgba(255,255,255,0.12)",
          ring: "#7dd3fc",
        },
        terminal: {
          background: "#0d0d10",
          foreground: "#e8e8ea",
          cursor: "#e8e8ea",
          cursorAccent: "#0d0d10",
          selection: "rgba(125,211,252,0.22)",
          fontFamily: "JetBrains Mono",
          fontWeight: "normal",
          fontSize: 14,
          ansi: [
            "#1c1c22", "#f2777a", "#99cc99", "#ffcc66",
            "#6699cc", "#cc99cc", "#66cccc", "#d3d0c8",
            "#747369", "#f2777a", "#99cc99", "#ffcc66",
            "#6699cc", "#cc99cc", "#66cccc", "#f2f0ec",
          ],
        },
      },
      light: {
        colors: {
          background: "#fbfbfd",
          foreground: "#1a1a1f",
          card: "#ffffff",
          cardForeground: "#1a1a1f",
          popover: "#ffffff",
          popoverForeground: "#1a1a1f",
          primary: "#0369a1",
          primaryForeground: "#ffffff",
          muted: "#f0f0f4",
          mutedForeground: "#5a5a66",
          accent: "#f0f0f4",
          accentForeground: "#1a1a1f",
          border: "rgba(0,0,0,0.10)",
          input: "rgba(0,0,0,0.14)",
          ring: "#0369a1",
        },
        terminal: {
          background: "#fbfbfd",
          foreground: "#1a1a1f",
          cursor: "#1a1a1f",
          cursorAccent: "#fbfbfd",
          selection: "rgba(3,105,161,0.18)",
          fontFamily: "JetBrains Mono",
          fontWeight: "normal",
          fontSize: 14,
          ansi: [
            "#1a1a1f", "#c7254e", "#4c7a2f", "#8a6116",
            "#2b6cb0", "#8b4a8b", "#2a7f7f", "#5a5a66",
            "#747369", "#a01f42", "#3d6226", "#6f4e12",
            "#22548c", "#6f3b6f", "#216565", "#1a1a1f",
          ],
        },
      },
    },
  };
}

export function emitThemeEdit(req: ThemeEditRequest): Promise<void> {
  return emit(THEME_EDIT_EVENT, req);
}

export function onThemeEdit(
  cb: (req: ThemeEditRequest) => void,
): Promise<UnlistenFn> {
  return listen<ThemeEditRequest>(THEME_EDIT_EVENT, (e) => cb(e.payload));
}
