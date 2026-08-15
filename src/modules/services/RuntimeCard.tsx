import { Button } from "@/components/ui/button";
import {
  probeRuntime,
  runtimeMessage,
  type RuntimeStatus,
} from "@/modules/services/lib/runtime";
import { useCallback, useEffect, useState } from "react";

export function RuntimeCard({
  onStatus,
}: {
  onStatus: (s: RuntimeStatus | null) => void;
}) {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const next = await probeRuntime();
      setStatus(next);
      onStatus(next);
    } finally {
      setBusy(false);
    }
  }, [onStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!status) {
    return <div className="text-muted-foreground text-sm">Checking runtime</div>;
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
                  ? "size-2 rounded-full bg-emerald-500"
                  : "size-2 rounded-full bg-amber-500"
              }
            />
            {msg.title}
          </div>
          <p className="mt-1 text-muted-foreground text-xs">{msg.detail}</p>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>
          Check again
        </Button>
      </div>
    </div>
  );
}
