import { cn } from "@/lib/utils";
import { useTheme } from "@/modules/theme";
import { type ReactEventHandler, useEffect, useState } from "react";
import { nerdProvider } from "./nerdIcons";

export type FileIcon =
  | { kind: "image"; url: string }
  | { kind: "glyph"; char: string; tone: "folder" | "file" }
  | { kind: "none" };

export interface IconProvider {
  file(name: string): FileIcon;
  folder(name: string, open: boolean): FileIcon;
}

const NONE: FileIcon = { kind: "none" };
const PENDING: IconProvider = { file: () => NONE, folder: () => NONE };

// The Catppuccin set is 70 kB of SVG plus its name tables, so it stays out of
// the startup bundle and loads the first time a theme asks for it.
let catppuccin: IconProvider | null = null;
let loading: Promise<IconProvider> | null = null;

function loadCatppuccin(): Promise<IconProvider> {
  if (!loading) {
    loading = import("./catppuccinIcons").then((m) => {
      catppuccin = m.catppuccinProvider;
      return catppuccin;
    });
  }
  return loading;
}

export function useIconProvider(): IconProvider {
  const { activeVariant } = useTheme();
  const set = activeVariant.icons ?? "catppuccin";
  const [, bump] = useState(0);
  useEffect(() => {
    if (set !== "catppuccin" || catppuccin) return;
    let alive = true;
    void loadCatppuccin().then(() => {
      if (alive) bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [set]);
  if (set === "nerd") return nerdProvider;
  return catppuccin ?? PENDING;
}

export function FileIconView({
  icon,
  className,
  onImageError,
}: {
  icon: FileIcon;
  className?: string;
  onImageError?: ReactEventHandler<HTMLImageElement>;
}) {
  if (icon.kind === "image") {
    return (
      <img
        src={icon.url}
        alt=""
        className={cn("shrink-0 object-contain", className)}
        onError={onImageError}
      />
    );
  }
  if (icon.kind === "glyph") {
    return (
      <span
        aria-hidden
        className={cn(
          "terra-file-icon shrink-0",
          icon.tone === "folder" && "text-primary",
          className,
        )}
      >
        {icon.char}
      </span>
    );
  }
  return <span className={cn("shrink-0", className)} />;
}
