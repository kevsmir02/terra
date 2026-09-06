import type { FileIcon, IconProvider } from "./iconProvider";

// Codepoints from the Font Awesome, Devicons, and Seti ranges, which Nerd
// Fonts v3 keeps in the BMP. Anything unlisted gets the generic file glyph.
const FOLDER = "";
const FOLDER_OPEN = "";
const FILE = "";
const TEXT = "";
const CONFIG = "";
const LOCK = "";
const GIT = "";
const IMAGE = "";
const ARCHIVE = "";
const AUDIO = "";
const VIDEO = "";
const FONT = "";
const DATABASE = "";
const SHELL = "";
const JSON_GLYPH = "";
const MARKDOWN = "";
const TYPESCRIPT = "";
const JAVASCRIPT = "";
const REACT = "";

const BY_NAME: Readonly<Record<string, string>> = {
  ".gitignore": GIT,
  ".gitattributes": GIT,
  ".gitmodules": GIT,
  ".editorconfig": CONFIG,
  ".env": CONFIG,
  "package.json": "",
  "pnpm-lock.yaml": LOCK,
  "package-lock.json": LOCK,
  "yarn.lock": LOCK,
  "cargo.lock": LOCK,
  "cargo.toml": "",
  dockerfile: "",
  makefile: CONFIG,
  license: TEXT,
  "readme.md": MARKDOWN,
  "biome.json": JSON_GLYPH,
  "tsconfig.json": TYPESCRIPT,
};

const BY_EXT: Readonly<Record<string, string>> = {
  ts: TYPESCRIPT,
  mts: TYPESCRIPT,
  cts: TYPESCRIPT,
  tsx: REACT,
  js: JAVASCRIPT,
  mjs: JAVASCRIPT,
  cjs: JAVASCRIPT,
  jsx: REACT,
  json: JSON_GLYPH,
  jsonc: JSON_GLYPH,
  md: MARKDOWN,
  mdx: MARKDOWN,
  css: "",
  scss: "",
  html: "",
  rs: "",
  py: "",
  go: "",
  java: "",
  c: "",
  h: "",
  cpp: "",
  hpp: "",
  vue: "",
  toml: CONFIG,
  yaml: "",
  yml: "",
  ini: CONFIG,
  conf: CONFIG,
  lock: LOCK,
  sh: SHELL,
  bash: SHELL,
  zsh: SHELL,
  fish: SHELL,
  svg: IMAGE,
  png: IMAGE,
  jpg: IMAGE,
  jpeg: IMAGE,
  gif: IMAGE,
  webp: IMAGE,
  ico: IMAGE,
  pdf: "",
  zip: ARCHIVE,
  gz: ARCHIVE,
  tar: ARCHIVE,
  "7z": ARCHIVE,
  mp4: VIDEO,
  webm: VIDEO,
  mkv: VIDEO,
  mp3: AUDIO,
  wav: AUDIO,
  ogg: AUDIO,
  ttf: FONT,
  otf: FONT,
  woff: FONT,
  woff2: FONT,
  sql: DATABASE,
  db: DATABASE,
  sqlite: DATABASE,
  txt: TEXT,
  log: TEXT,
};

function extChain(lower: string): string[] {
  const parts = lower.split(".");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(i).join("."));
  return out;
}

function glyph(char: string, tone: "folder" | "file"): FileIcon {
  return { kind: "glyph", char, tone };
}

export const nerdProvider: IconProvider = {
  file(name) {
    const lower = name.toLowerCase();
    const byName = BY_NAME[lower];
    if (byName) return glyph(byName, "file");
    for (const ext of extChain(lower)) {
      const c = BY_EXT[ext];
      if (c) return glyph(c, "file");
    }
    return glyph(FILE, "file");
  },
  folder(_name, open) {
    return glyph(open ? FOLDER_OPEN : FOLDER, "folder");
  },
};
