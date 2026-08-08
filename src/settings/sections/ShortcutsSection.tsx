import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setShortcuts } from "@/modules/settings/store";
import {
  getBindingTokens,
  type KeyBinding,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  type Shortcut,
  type ShortcutId,
} from "@/modules/shortcuts/shortcuts";
import {
  ArrowTurnBackwardIcon,
  Delete02Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  conflictingShortcuts,
  shortcutLabels,
  type UserShortcuts,
} from "@/modules/shortcuts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

export function ShortcutsSection() {
  const userShortcuts = usePreferencesStore((s) => s.shortcuts);
  const [search, setSearch] = useState("");
  const [recordingId, setRecordingId] = useState<ShortcutId | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const filteredShortcuts = useMemo(() => {
    // Filter out internal/non-overridable shortcuts like tab.selectByIndex.
    const base = SHORTCUTS.filter((s) => s.id !== "tab.selectByIndex");
    if (!search) return base;
    const lower = search.toLowerCase();
    return base.filter(
      (s) =>
        s.label.toLowerCase().includes(lower) ||
        s.group.toLowerCase().includes(lower),
    );
  }, [search]);

  const onRecord = (id: ShortcutId, binding: KeyBinding) => {
    const next = { ...userShortcuts, [id]: [binding] };
    void setShortcuts(next);
    setRecordingId(null);
  };

  const onClear = (id: ShortcutId) => {
    const next = { ...userShortcuts, [id]: [] };
    void setShortcuts(next);
  };

  const onResetShortcut = (id: ShortcutId) => {
    const next = { ...userShortcuts };
    delete next[id];
    void setShortcuts(next);
  };

  const onResetAll = () => {
    void setShortcuts({});
    setResetDialogOpen(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <SectionHeader
          title="Shortcuts"
          description="View and customize keyboard shortcuts."
        />
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2.5 text-[11px]"
          onClick={() => setResetDialogOpen(true)}
        >
          <HugeiconsIcon
            icon={ArrowTurnBackwardIcon}
            size={12}
            strokeWidth={2}
          />
          Reset All
        </Button>
      </div>

      <div className="relative">
        <HugeiconsIcon
          icon={Search01Icon}
          size={14}
          strokeWidth={2}
          className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          placeholder="Search shortcuts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 pl-9 text-[12.5px]"
        />
      </div>

      <div className="flex flex-col gap-8">
        {SHORTCUT_GROUPS.map((group) => {
          const items = filteredShortcuts.filter((s) => s.group === group);
          if (items.length === 0) return null;

          return (
            <div key={group} className="flex flex-col gap-3">
              <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {group}
              </h3>
              <div className="flex flex-col divide-y divide-border/(--emph-soft) rounded-lg border border-border/(--emph-strong) bg-card/(--emph-soft) overflow-hidden">
                {items.map((s) => (
                  <ShortcutRow
                    key={s.id}
                    shortcut={s}
                    isRecording={recordingId === s.id}
                    onStartRecording={() => setRecordingId(s.id)}
                    onStopRecording={() => setRecordingId(null)}
                    onRecord={(b) => onRecord(s.id, b)}
                    onClear={() => onClear(s.id)}
                    onReset={() => onResetShortcut(s.id)}
                    userBindings={userShortcuts[s.id]}
                    userShortcuts={userShortcuts}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all shortcuts?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revert all your custom keyboard shortcuts to their
              factory defaults. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onResetAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/(--emph-bold)"
            >
              Reset All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ShortcutRow({
  shortcut,
  isRecording,
  onStartRecording,
  onStopRecording,
  onRecord,
  onClear,
  onReset,
  userBindings,
  userShortcuts,
}: {
  shortcut: Shortcut;
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onRecord: (b: KeyBinding) => void;
  onClear: () => void;
  onReset: () => void;
  userBindings?: KeyBinding[];
  userShortcuts: UserShortcuts;
}) {
  const bindings =
    userBindings !== undefined ? userBindings : shortcut.defaultBindings;
  const isModified = userBindings !== undefined;
  const hasBindings = bindings && bindings.length > 0;

  // Two-step recording only catches clashes made from now on; a duplicate
  // saved before this shipped would otherwise stay invisible.
  const conflicts = useMemo(
    () => [
      ...new Set(
        (bindings ?? []).flatMap((b) =>
          conflictingShortcuts(b, shortcut.id, userShortcuts),
        ),
      ),
    ],
    [bindings, shortcut.id, userShortcuts],
  );

  return (
    <div className="group flex items-center justify-between px-3 py-2.5 transition-colors hover:bg-muted/(--emph-subtle)">
      <div className="flex flex-col gap-0.5">
        <span className="text-[12.5px] font-medium">{shortcut.label}</span>
        {conflicts.length > 0 && (
          <span className="text-[11px] text-destructive">
            Conflicts with {shortcutLabels(conflicts).join(", ")}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {isRecording ? (
          <Recorder
            selfId={shortcut.id}
            onRecord={onRecord}
            onCancel={onStopRecording}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={onStartRecording}
              className="flex min-w-[100px] cursor-pointer items-center justify-end gap-1"
            >
              {hasBindings ? (
                <KbdGroup>
                  {getBindingTokens(bindings[0]).map((t, i) => (
                    <Kbd
                      // biome-ignore lint/suspicious/noArrayIndexKey: fixed-order tokens of one binding, re-rendered whole
                      key={i}
                      className="group-hover:bg-accent group-hover:text-accent-foreground transition-colors"
                    >
                      {t}
                    </Kbd>
                  ))}
                </KbdGroup>
              ) : (
                <span className="text-[11px] text-muted-foreground italic">
                  Unassigned
                </span>
              )}
            </button>

            <div className="flex items-center gap-1">
              {isModified && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  onClick={onReset}
                  title="Reset to default"
                >
                  <HugeiconsIcon icon={ArrowTurnBackwardIcon} size={12} />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive opacity-0 transition-opacity group-hover:opacity-100"
                onClick={onClear}
                title="Clear shortcut"
              >
                <HugeiconsIcon icon={Delete02Icon} size={12} />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Recorder({
  selfId,
  onRecord,
  onCancel,
}: {
  selfId: ShortcutId;
  onRecord: (b: KeyBinding) => void;
  onCancel: () => void;
}) {
  const userShortcuts = usePreferencesStore((s) => s.shortcuts);
  const [pending, setPending] = useState<KeyBinding | null>(null);
  // The keydown listener is bound once, so it reads the captured chord through
  // a ref rather than a stale closure over state.
  const pendingRef = useRef<KeyBinding | null>(null);

  const capture = useCallback((b: KeyBinding | null) => {
    pendingRef.current = b;
    setPending(b);
  }, []);

  const conflicts = useMemo(
    () => (pending ? conflictingShortcuts(pending, selfId, userShortcuts) : []),
    [pending, selfId, userShortcuts],
  );

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Bare Enter applies the captured chord. Safe to claim because the
      // capture guard below rejects it as a binding, while Shift+Enter — the
      // default for terminal.newline — still records normally.
      const held = pendingRef.current;
      if (
        held &&
        e.key === "Enter" &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey &&
        !e.metaKey
      ) {
        onRecord(held);
        return;
      }

      if (e.key === "Escape") {
        onCancel();
        return;
      }

      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

      // Require at least one primary modifier (Ctrl, Alt, Meta).
      // Reject Shift-only shortcuts that would insert a character — this is
      // what blocks Shift+2 ("@") and Shift+, ("<") on many layouts.
      const hasPrimaryModifier = e.ctrlKey || e.altKey || e.metaKey;
      const isCharacterKey = e.key.length === 1;
      if (!hasPrimaryModifier && (!e.shiftKey || isCharacterKey)) return;

      // Replaces any previously captured chord, so the user can re-try
      // without leaving the recorder.
      capture({
        key: e.key,
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey,
      });
    };

    window.addEventListener("keydown", onDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onDown, { capture: true });
    };
  }, [onRecord, onCancel, capture]);

  if (!pending) {
    return (
      <div className="flex items-center gap-2 rounded bg-accent/(--emph-medium) px-2 py-1 text-[11px] ring-1 ring-accent">
        <span className="animate-pulse font-medium">Recording...</span>
        <span className="text-muted-foreground">(Esc to cancel)</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1 rounded bg-accent/(--emph-medium) px-2 py-1.5 text-[11px] ring-1 ring-accent">
      <div className="flex items-center gap-2">
        <KbdGroup>
          {getBindingTokens(pending).map((t, i) => (
            <Kbd
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-order tokens of one binding, re-rendered whole
              key={i}
            >
              {t}
            </Kbd>
          ))}
        </KbdGroup>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => onRecord(pending)}
        >
          Apply
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
      {conflicts.length > 0 && (
        <span className="text-destructive">
          Already used by {shortcutLabels(conflicts).join(", ")}
        </span>
      )}
      <span className="text-muted-foreground">Enter to apply · Esc to cancel</span>
    </div>
  );
}
