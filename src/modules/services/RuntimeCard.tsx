import { Button } from "@/components/ui/button";
import {
  runtimeMessage,
  type RuntimeStatus,
} from "@/modules/services/lib/runtime";

export function RuntimeCard({
  status,
  busy,
  error,
  onRefresh,
}: {
  status: RuntimeStatus | null;
  busy: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  if (error) {
    return (
      <div className="rounded-md border p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-destructive text-sm">{error}</p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={onRefresh}
          >
            Check again
          </Button>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="text-muted-foreground text-sm">Checking runtime</div>
    );
  }

  const msg = runtimeMessage(status);
  return (
    <div className="rounded-md border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-medium text-sm">
            <span
              className={
                msg.ok
                  ? "size-2 rounded-full bg-status-ok"
                  : "size-2 rounded-full bg-status-warning"
              }
            />
            {msg.title}
          </div>
          <p className="mt-1 text-muted-foreground text-xs">{msg.detail}</p>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={onRefresh}>
          Check again
        </Button>
      </div>
    </div>
  );
}
