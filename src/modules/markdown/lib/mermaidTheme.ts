import { APP_FONT_FAMILY } from "@/lib/fonts";
import { parseColor, type ThemeVar } from "@/modules/theme";

// Mermaid parses colours with khroma, which knows hex, rgb and hsl only, so
// every theme value (some are oklch) is re-emitted as hex before it is handed
// over. Variables Mermaid's base theme then derives from these stay derived.
const ROLE_VARS: Record<string, string> = {
  background: "--background",
  mainBkg: "--muted",
  primaryColor: "--muted",
  primaryTextColor: "--foreground",
  primaryBorderColor: "--border",
  secondaryColor: "--accent",
  secondaryTextColor: "--accent-foreground",
  secondaryBorderColor: "--border",
  tertiaryColor: "--card",
  tertiaryTextColor: "--card-foreground",
  tertiaryBorderColor: "--border",
  lineColor: "--muted-foreground",
  textColor: "--foreground",
  titleColor: "--foreground",
  nodeBorder: "--border",
  clusterBkg: "--card",
  clusterBorder: "--border",
  edgeLabelBackground: "--background",
  noteBkgColor: "--card",
  noteTextColor: "--card-foreground",
  noteBorderColor: "--border",
  actorBkg: "--muted",
  actorBorder: "--border",
  actorTextColor: "--foreground",
  actorLineColor: "--muted-foreground",
  signalColor: "--muted-foreground",
  signalTextColor: "--foreground",
  labelBoxBkgColor: "--muted",
  labelBoxBorderColor: "--border",
  labelTextColor: "--foreground",
  loopTextColor: "--foreground",
  activationBkgColor: "--accent",
  activationBorderColor: "--border",
  errorBkgColor: "--status-deleted",
  errorTextColor: "--foreground",
};

export type MermaidThemeConfig = {
  theme: "base";
  darkMode: boolean;
  fontFamily: string;
  themeVariables: Record<string, string | boolean>;
};

export function toHex(value: string | undefined): string | null {
  const rgb = parseColor(value);
  if (!rgb) return null;
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}

export function mermaidThemeConfig(
  vars: readonly ThemeVar[],
  mode: "light" | "dark",
): MermaidThemeConfig {
  const byName = new Map(vars);
  const themeVariables: Record<string, string | boolean> = {
    darkMode: mode === "dark",
    fontFamily: APP_FONT_FAMILY,
    fontSize: "13px",
  };
  for (const [role, cssVar] of Object.entries(ROLE_VARS)) {
    const hex = toHex(byName.get(cssVar));
    if (hex) themeVariables[role] = hex;
  }
  return {
    theme: "base",
    darkMode: mode === "dark",
    fontFamily: APP_FONT_FAMILY,
    themeVariables,
  };
}
