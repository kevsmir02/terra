import {
  EDITOR_THEME_MODE,
  type EditorThemeId,
} from "@/modules/settings/store";
import type { EditorThemeResolution } from "@/modules/theme";
import type { Extension } from "@codemirror/state";
import { build, derivedDark, derivedLight } from "./cmThemes";

type ThemeLoader = () => Promise<Extension>;

const presets = () => import("./cmPresetThemes");

// Only the active preset is fetched, and "auto" (the default) needs none.
const EDITOR_THEME_LOADERS: Record<EditorThemeId, ThemeLoader> = {
  kanagawa: () => presets().then((m) => build(m.kanagawa)),
  "kanagawa-lotus": () => presets().then((m) => build(m.kanagawaLotus)),
  "kanagawa-dragon": () => presets().then((m) => build(m.kanagawaDragon)),
  "tokyo-night": () =>
    import("@uiw/codemirror-theme-tokyo-night").then((m) => m.tokyoNight),
  "catppuccin-mocha": () => presets().then((m) => build(m.catppuccinMocha)),
  "catppuccin-latte": () => presets().then((m) => build(m.catppuccinLatte)),
  "rose-pine": () => presets().then((m) => build(m.rosePine)),
  "rose-pine-dawn": () => presets().then((m) => build(m.rosePineDawn)),
  everforest: () => presets().then((m) => build(m.everforestDark)),
  "everforest-light": () => presets().then((m) => build(m.everforestLight)),
  dracula: () => presets().then((m) => build(m.dracula)),
  "solarized-dark": () => presets().then((m) => build(m.solarizedDark)),
  "solarized-light": () => presets().then((m) => build(m.solarizedLight)),
  nord: () => import("@uiw/codemirror-theme-nord").then((m) => m.nord),
  "gruvbox-dark": () =>
    import("@uiw/codemirror-theme-gruvbox-dark").then((m) => m.gruvboxDark),
  atomone: () => import("@uiw/codemirror-theme-atomone").then((m) => m.atomone),
  aura: () => import("@uiw/codemirror-theme-aura").then((m) => m.aura),
  copilot: () => import("@uiw/codemirror-theme-copilot").then((m) => m.copilot),
  "github-dark": () =>
    import("@uiw/codemirror-theme-github").then((m) => m.githubDark),
  "github-light": () =>
    import("@uiw/codemirror-theme-github").then((m) => m.githubLight),
  "xcode-dark": () =>
    import("@uiw/codemirror-theme-xcode").then((m) => m.xcodeDark),
  "xcode-light": () =>
    import("@uiw/codemirror-theme-xcode").then((m) => m.xcodeLight),
};

export type EditorThemeCache = {
  /** The extension when it can be applied now, else the one in-flight load. */
  pick: (target: EditorThemeResolution) => Extension | Promise<Extension>;
  /** The last extension `pick` could apply, shown while a switch loads. */
  lastReady: () => Extension | null;
};

export function createEditorThemeCache(
  loaders: Record<EditorThemeId, ThemeLoader>,
): EditorThemeCache {
  const loaded = new Map<EditorThemeId, Extension>();
  const inflight = new Map<EditorThemeId, Promise<Extension>>();
  let last: Extension | null = null;

  const derived = (mode: "light" | "dark") =>
    mode === "dark" ? derivedDark : derivedLight;

  function load(id: EditorThemeId): Promise<Extension> {
    let p = inflight.get(id);
    if (!p) {
      const loader = loaders[id];
      p = (loader ? loader() : Promise.reject(new Error("unknown theme")))
        .catch((e: unknown) => {
          // A missing chunk degrades to the engine-derived palette of the same
          // mode rather than an unthemed editor or a render loop of retries.
          console.warn(`[editor] theme ${id} failed to load`, e);
          return derived(EDITOR_THEME_MODE[id] ?? "dark");
        })
        .then((ext) => {
          loaded.set(id, ext);
          return ext;
        });
      inflight.set(id, p);
    }
    return p;
  }

  return {
    pick(target) {
      if (target.kind === "derived") {
        last = derived(target.mode);
        return last;
      }
      const ready = loaded.get(target.id);
      if (!ready) return load(target.id);
      last = ready;
      return ready;
    },
    lastReady: () => last,
  };
}

export const editorThemes = createEditorThemeCache(EDITOR_THEME_LOADERS);
