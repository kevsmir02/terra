import { resolveTheme, useTheme } from "@/modules/theme";
import { useEffect, useMemo, useState } from "react";
import type { DiagramPlugin } from "streamdown";
import { hasMermaidFence } from "./mermaidFence";
import { type MermaidThemeConfig, mermaidThemeConfig } from "./mermaidTheme";

let loading: Promise<DiagramPlugin> | null = null;

// Mermaid is the largest chunk in the app, so it loads once, and only after a
// document with a mermaid fence is actually rendered.
function loadMermaidPlugin(): Promise<DiagramPlugin> {
  loading ??= import("@streamdown/mermaid").then((m) => m.mermaid);
  return loading;
}

export function useMermaid(markdown: string | null): {
  plugin: DiagramPlugin | null;
  config: MermaidThemeConfig | null;
} {
  const wanted = markdown !== null && hasMermaidFence(markdown);
  const [plugin, setPlugin] = useState<DiagramPlugin | null>(null);
  const { activeTheme, resolvedMode } = useTheme();

  useEffect(() => {
    if (!wanted || plugin) return;
    let cancelled = false;
    loadMermaidPlugin().then((p) => {
      if (!cancelled) setPlugin(p);
    });
    return () => {
      cancelled = true;
    };
  }, [wanted, plugin]);

  const config = useMemo(
    () =>
      wanted && plugin
        ? mermaidThemeConfig(
            resolveTheme(activeTheme, resolvedMode) ?? [],
            resolvedMode,
          )
        : null,
    [wanted, plugin, activeTheme, resolvedMode],
  );

  return { plugin: wanted ? plugin : null, config };
}
