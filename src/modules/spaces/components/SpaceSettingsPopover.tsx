import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { native } from "@/lib/native";
import { cn } from "@/lib/utils";
import { SPACE_COLORS } from "../lib/spaceColor";
import type { SpaceMeta } from "../lib/store";
import { useSpaces } from "../lib/useSpaces";
import { Cancel01Icon, PlusSignIcon, Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";

type Props = {
  space: SpaceMeta;
  /** Trigger element; typically a RowAction gear rendered by SpaceSwitcher. */
  trigger: React.ReactNode;
};

export function SpaceSettingsPopover({ space, trigger }: Props) {
  const rename = useSpaces((s) => s.rename);
  const setRoot = useSpaces((s) => s.setRoot);
  const setColor = useSpaces((s) => s.setColor);
  const setStartupCommands = useSpaces((s) => s.setStartupCommands);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(space.name);
  const [root, setRootField] = useState(space.root ?? "");
  const [cmds, setCmds] = useState<string[]>(space.startupCommands ?? []);
  const [draft, setDraft] = useState("");

  // Re-sync local fields when the popover opens (space may have been edited elsewhere).
  useEffect(() => {
    if (!open) return;
    setName(space.name);
    setRootField(space.root ?? "");
    setCmds(space.startupCommands ?? []);
    setDraft("");
  }, [open, space.name, space.root, space.startupCommands]);

  const commitName = (v: string) => {
    const trimmed = v.trim();
    if (trimmed && trimmed !== space.name) rename(space.id, trimmed);
    else setName(space.name);
  };
  const commitRoot = (v: string) => {
    const next = v.trim() || null;
    if (next === space.root) {
      setRootField(space.root ?? "");
      return;
    }
    // Typing a root is the user gesture that authorizes it; the fs commands are
    // gated on the registry, so without this a root outside home reads as empty.
    if (next) void native.workspaceAuthorize(next).catch(() => {});
    setRoot(space.id, next);
  };
  const addCommand = () => {
    const v = draft.trim();
    if (!v) return;
    const next = [...cmds, v];
    setCmds(next);
    setStartupCommands(space.id, next);
    setDraft("");
  };
  const removeCommand = (idx: number) => {
    const next = cmds.filter((_, i) => i !== idx);
    setCmds(next);
    setStartupCommands(space.id, next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[22rem] p-3"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <HugeiconsIcon icon={Settings01Icon} size={14} strokeWidth={1.75} />
            <span>Space settings</span>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/(--emph-strong)">
              Name
            </span>
            <input
              aria-label="Space name"
              defaultValue={name}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitName(e.currentTarget.value);
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              onBlur={(e) => commitName(e.currentTarget.value)}
              className="w-full rounded-md bg-background px-2 py-1 text-xs ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/(--emph-strong)">
              Root directory
            </span>
            <input
              aria-label="Space root directory"
              defaultValue={root}
              value={root}
              onChange={(e) => setRootField(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRoot(e.currentTarget.value);
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              onBlur={(e) => commitRoot(e.currentTarget.value)}
              placeholder={space.root ?? "/path/to/project"}
              className="w-full rounded-md bg-background px-2 py-1 font-mono text-[11px] ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/(--emph-strong)">
              Accent color
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                aria-label="Theme primary"
                onClick={() => setColor(space.id, undefined)}
                className={cn(
                  "size-5 rounded-full ring-1 ring-inset transition",
                  space.color == null
                    ? "ring-foreground/(--emph-bold)"
                    : "ring-border hover:ring-foreground/(--emph-soft)",
                )}
                style={{ backgroundColor: "var(--primary)" }}
              />
              {SPACE_COLORS.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Accent ${i + 1}`}
                  onClick={() => setColor(space.id, i)}
                  className={cn(
                    "size-5 rounded-full ring-1 ring-inset transition",
                    space.color === i
                      ? "ring-foreground/(--emph-bold)"
                      : "ring-transparent hover:ring-foreground/(--emph-soft)",
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/(--emph-strong)">
              Startup commands
            </span>
            <div className="flex flex-col gap-1">
              {cmds.map((c, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: stateless rows removed by index; no reorder to desync
                  key={`${c}-${i}`}
                  className="flex items-center gap-1.5 rounded-md bg-muted/(--emph-medium) px-1.5 py-1"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                    {c}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove command"
                    onClick={() => removeCommand(i)}
                    className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
                  </button>
                </div>
              ))}
              {cmds.length === 0 && (
                <span className="px-1 text-[10.5px] text-muted-foreground/(--emph-strong)">
                  No startup commands
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                aria-label="New startup command"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCommand();
                  }
                }}
                placeholder="pnpm dev"
                className="min-w-0 flex-1 rounded-md bg-background px-2 py-1 font-mono text-[11px] ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                aria-label="Add command"
                onClick={addCommand}
                disabled={!draft.trim()}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
