import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  connectionDetails,
  type ServiceId,
} from "@/modules/services/lib/connection";
import {
  MAX_PORT,
  MIN_PORT,
  parsePort,
  VOLUME_BY_ID,
} from "@/modules/services/lib/config";
import { useEffect, useState } from "react";

export type RowStatus = "stopped" | "starting" | "healthy" | "unhealthy";

export function statusColor(s: RowStatus): string {
  switch (s) {
    case "healthy":
      return "bg-status-ok";
    case "starting":
      return "bg-status-warning";
    case "unhealthy":
      return "bg-destructive";
    default:
      return "bg-muted";
  }
}

export function ServiceRow({
  id,
  label,
  port,
  status,
  enabled,
  busy,
  password,
  onToggle,
  onPortChange,
  onOpen,
  onDeleteData,
  disabled = false,
  disabledReason,
}: {
  id: ServiceId;
  label: string;
  port: number;
  status: RowStatus;
  enabled: boolean;
  busy: boolean;
  password: string;
  onToggle: (next: boolean) => void;
  onPortChange: (next: number) => void;
  onOpen: () => void;
  onDeleteData: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const details = connectionDetails(id, port, password);
  const isWebUi = id === "mailpit" || id === "adminer";
  const volume = VOLUME_BY_ID[id];
  const [showPassword, setShowPassword] = useState(false);

  // The field is edited as text and only committed once it parses. Writing
  // every keystroke through persisted a 0 for a cleared field, and anything
  // over 65535 failed the next start with a raw deserialization error.
  const [draft, setDraft] = useState(String(port));
  useEffect(() => setDraft(String(port)), [port]);
  const commitPort = () => {
    const parsed = parsePort(draft);
    if (parsed === null) setDraft(String(port));
    else if (parsed !== port) onPortChange(parsed);
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2">
      <span className={`size-2 rounded-full ${statusColor(status)}`} />
      <span className="min-w-28 font-medium text-sm">{label}</span>
      <Input
        className="h-7 w-24"
        type="number"
        min={MIN_PORT}
        max={MAX_PORT}
        aria-label={`${label} port`}
        value={draft}
        disabled={enabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitPort}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitPort();
        }}
      />
      {busy && (
        <span className="text-muted-foreground text-xs">
          {id === "web" ? "Building PHP image, one time only" : "Working"}
        </span>
      )}
      {disabledReason && (
        <span className="text-muted-foreground text-xs">{disabledReason}</span>
      )}
      {details && status === "healthy" && (
        <Collapsible className="basis-full">
          <CollapsibleTrigger asChild>
            <Button size="sm" variant="ghost">
              Connection details
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 grid gap-1 rounded-md bg-muted p-2 text-xs sm:grid-cols-2">
            {[
              ["Host", details.host],
              ["Port", String(details.port)],
              ...(details.user ? [["User", details.user]] : []),
              ...(details.password
                ? [["Password", showPassword ? details.password : "********"]]
                : []),
              ...(details.database ? [["Database", details.database]] : []),
              ["Connection string", details.dsn],
            ].map(([label, value]) => (
              <div key={label} className="flex min-w-0 items-center gap-2">
                <span className="w-28 shrink-0 text-muted-foreground">
                  {label}
                </span>
                <code className="min-w-0 flex-1 truncate">{value}</code>
                {label === "Password" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5"
                    onClick={() => setShowPassword((shown) => !shown)}
                  >
                    {showPassword ? "Hide" : "Reveal"}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5"
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      label === "Password" && details.password
                        ? details.password
                        : value,
                    )
                  }
                >
                  Copy
                </Button>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
      {isWebUi && status === "healthy" && (
        <Button size="sm" variant="ghost" onClick={onOpen}>
          Open
        </Button>
      )}
      {volume && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost" className="text-destructive">
              Delete data
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {label} data?</AlertDialogTitle>
              <AlertDialogDescription>
                Stops {label} and removes the {volume} volume. Other services
                keep running. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDeleteData}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      <Switch
        className="ml-auto"
        checked={enabled}
        disabled={busy || disabled}
        onCheckedChange={onToggle}
      />
    </div>
  );
}
