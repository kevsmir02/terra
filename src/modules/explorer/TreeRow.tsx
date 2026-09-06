import { cn } from "@/lib/utils";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo } from "react";
import { InlineInput } from "./InlineInput";
import { explorerGitTextClass } from "./lib/gitStatusColor";
import type { GitStatusCode } from "./lib/gitStatusUtils";
import { FileIconView, useIconProvider } from "./lib/iconProvider";
import { type RowGesture, rowActivation } from "./lib/rowActivation";

export type RowActions = {
  toggle: (path: string) => void;
  beginRename: (path: string) => void;
  commitRename: (newName: string) => void | Promise<void>;
  cancelRename: () => void;
};

export type EntryRowProps = {
  path: string;
  name: string;
  isDir: boolean;
  isExpanded: boolean;
  depth: number;
  actions: RowActions;
  renameInProgress: boolean;
  isSelected: boolean;
  isRenaming: boolean;
  isDropTarget?: boolean;
  onOpenFile: (path: string, pin?: boolean) => void;
  onSelectPath: (path: string) => void;
  openOnDoubleClick: boolean;
  gitStatusCode?: GitStatusCode | null;
  gitignored?: boolean;
};

function EntryRowImpl(props: EntryRowProps) {
  const {
    path,
    name,
    isDir,
    isExpanded,
    depth,
    actions,
    renameInProgress,
    isSelected,
    isRenaming,
    isDropTarget = false,
    onOpenFile,
    onSelectPath,
    openOnDoubleClick,
    gitStatusCode,
    gitignored = false,
  } = props;

  const icons = useIconProvider();
  const icon = isDir ? icons.folder(name, isExpanded) : icons.file(name);
  const paddingLeft = 6 + depth * 12;

  if (isRenaming) {
    return (
      <div
        className="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
        style={{ paddingLeft }}
      >
        <span className="size-3.5 shrink-0" />
        <FileIconView icon={icon} className="size-4" />
        <InlineInput
          initial={name}
          onCommit={actions.commitRename}
          onCancel={actions.cancelRename}
        />
      </div>
    );
  }

  const activate = (gesture: RowGesture) => {
    const action = rowActivation(gesture, isDir, openOnDoubleClick);
    if (action === "toggle") actions.toggle(path);
    else if (action === "open-preview") onOpenFile(path);
    else if (action === "open") onOpenFile(path, true);
    else if (action === "rename") actions.beginRename(path);
  };

  const handleClick = () => {
    if (renameInProgress) return;
    onSelectPath(path);
    activate("click");
  };

  return (
    <button
      type="button"
      data-fs-path={path}
      onClick={handleClick}
      onDoubleClick={() => activate("dblclick")}
      className={cn(
        "group flex h-6 w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 text-left text-[13px] transition-colors hover:bg-accent/(--emph-strong)",
        isSelected
          ? "bg-accent text-foreground"
          : gitignored
            ? "text-muted-foreground/(--emph-strong)"
            : "text-foreground/(--emph-bold)",
        isDropTarget &&
          "bg-primary/(--emph-faint) ring-1 ring-inset ring-primary/(--emph-strong)",
      )}
      style={{ paddingLeft }}
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
        {isDir ? (
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={12}
            strokeWidth={2.25}
            className={cn("transition-transform", isExpanded && "rotate-90")}
          />
        ) : null}
      </span>
      <FileIconView icon={icon} className="size-4" />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          !isSelected &&
            !gitignored &&
            gitStatusCode &&
            explorerGitTextClass(gitStatusCode),
        )}
      >
        {name}
      </span>
    </button>
  );
}

export const EntryRow = memo(EntryRowImpl);

export type PendingRowProps = {
  depth: number;
  kind: "file" | "dir";
  onCommit: (name: string) => void | Promise<void>;
  onCancel: () => void;
};

export function PendingRow({
  depth,
  kind,
  onCommit,
  onCancel,
}: PendingRowProps) {
  const icons = useIconProvider();
  return (
    <div
      className="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
      style={{ paddingLeft: 6 + depth * 12 }}
    >
      <span className="size-3.5 shrink-0" />
      <FileIconView
        icon={kind === "dir" ? icons.folder("", false) : icons.file("untitled")}
        className="size-4 opacity-70"
      />
      <InlineInput
        initial=""
        placeholder={kind === "dir" ? "New folder" : "New file"}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    </div>
  );
}

export function StatusRow({
  depth,
  message,
  tone,
}: {
  depth: number;
  message: string;
  tone: "muted" | "error";
}) {
  return (
    <div
      className={cn(
        "h-6 truncate px-2 text-[11px] leading-6",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
      style={{ paddingLeft: 6 + depth * 12 + 18 }}
    >
      {message}
    </div>
  );
}
