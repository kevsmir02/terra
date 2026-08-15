import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

export function LogsDrawer({ service }: { service: string }) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setLogs(await invoke<string>("services_logs", { service }));
    } catch (e) {
      setLogs(String(e));
    } finally {
      setBusy(false);
    }
  }, [service]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
          Logs
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
          {logs || "No logs yet."}
        </pre>
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-muted-foreground text-xs">
            For a live tail, run: docker compose logs -f {service} in a
            terminal
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Refresh
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
