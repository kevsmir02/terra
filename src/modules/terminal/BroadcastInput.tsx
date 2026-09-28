import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useId, useState, useSyncExternalStore } from "react";
import {
  type BroadcastCandidate,
  broadcastLine,
  broadcastRecipients,
  describeBroadcastTargets,
} from "./lib/broadcast";

/**
 * The session side, injected by the eager wrapper: importing the session or
 * agent modules here would split them out of the main chunk into a shared one
 * and grow the startup graph.
 */
export type BroadcastSessions = {
  probe: (leafId: number) => BroadcastCandidate;
  typeLine: (leafId: number, line: string) => void;
  /** Changes whenever an agent starts or exits. */
  subscribeAgents: (onChange: () => void) => () => void;
  agentsSnapshot: () => unknown;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Terminal leaves of the active tab in tree order; empty for any other tab. */
  leafIds: readonly number[];
  sessions: BroadcastSessions;
};

export function BroadcastInput({
  open,
  onOpenChange,
  leafIds,
  sessions,
}: Props) {
  const [agentsOnly, setAgentsOnly] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send to all panes</DialogTitle>
          <DialogDescription>
            Types the line into every pane of this tab and presses Enter.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so its agent subscription dies on close. */}
        <BroadcastForm
          leafIds={leafIds}
          sessions={sessions}
          agentsOnly={agentsOnly}
          onAgentsOnlyChange={setAgentsOnly}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function BroadcastForm({
  leafIds,
  sessions,
  agentsOnly,
  onAgentsOnlyChange,
  onDone,
}: {
  leafIds: readonly number[];
  sessions: BroadcastSessions;
  agentsOnly: boolean;
  onAgentsOnlyChange: (next: boolean) => void;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const checkboxId = useId();
  // Re-render when any agent starts or exits while the dialog is open.
  useSyncExternalStore(sessions.subscribeAgents, sessions.agentsSnapshot);
  const candidates = leafIds.map(sessions.probe);
  const recipients = broadcastRecipients(candidates, agentsOnly);
  const line = broadcastLine(text);
  const status = describeBroadcastTargets(candidates, recipients, agentsOnly);
  const canSend = line !== null && recipients.length > 0;

  const send = () => {
    if (line === null) return;
    for (const leafId of recipients) sessions.typeLine(leafId, line);
    setText("");
    onDone();
  };

  return (
    <>
      <Input
        autoFocus
        value={text}
        placeholder="Command or prompt"
        aria-describedby={`${checkboxId}-status`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (canSend) send();
          } else if (
            e.altKey &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.shiftKey &&
            e.code === "KeyA"
          ) {
            e.preventDefault();
            onAgentsOnlyChange(!agentsOnly);
          }
        }}
      />
      <div className="flex items-center gap-2">
        <Checkbox
          id={checkboxId}
          checked={agentsOnly}
          onCheckedChange={(v) => onAgentsOnlyChange(v === true)}
        />
        <Label htmlFor={checkboxId} className="gap-1.5 text-xs font-normal">
          Only panes running an agent
          <span className="text-muted-foreground">Alt+A</span>
        </Label>
      </div>
      <div
        id={`${checkboxId}-status`}
        aria-live="polite"
        className={cn(
          "text-xs",
          recipients.length > 0 ? "text-muted-foreground" : "text-destructive",
        )}
      >
        {status}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={!canSend} onClick={send}>
          Send
        </Button>
      </DialogFooter>
    </>
  );
}
