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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  connectionString,
  type ServiceId,
} from "@/modules/services/lib/connection";
import { VOLUME_BY_ID } from "@/modules/services/lib/config";

export type RowStatus = "stopped" | "starting" | "healthy" | "unhealthy";

export function statusColor(s: RowStatus): string {
  switch (s) {
    case "healthy":
      return "bg-emerald-500";
    case "starting":
      return "bg-amber-500";
    case "unhealthy":
      return "bg-red-500";
    default:
      return "bg-muted-foreground/40";
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
}) {
  const dsn = connectionString(id, port, password);
  const isWebUi = id === "mailpit" || id === "adminer";
  const volume = VOLUME_BY_ID[id];

  return (
    <div className="flex items-center gap-3 rounded-md border px-3 py-2">
      <span className={`size-2 rounded-full ${statusColor(status)}`} />
      <span className="min-w-28 font-medium text-sm">{label}</span>
      <Input
        className="h-7 w-24"
        type="number"
        value={port}
        disabled={enabled}
        onChange={(e) => onPortChange(Number(e.target.value))}
      />
      {busy && (
        <span className="text-muted-foreground text-xs">
          {id === "web" ? "Building PHP image, one time only" : "Working"}
        </span>
      )}
      {dsn && status === "healthy" && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void navigator.clipboard.writeText(dsn)}
        >
          Copy connection string
        </Button>
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
                Removes the {volume} volume. This cannot be undone.
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
        disabled={busy}
        onCheckedChange={onToggle}
      />
    </div>
  );
}
