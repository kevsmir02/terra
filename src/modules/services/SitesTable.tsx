import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { WorkspaceEnv } from "@/modules/workspace";

export type SiteRow = {
  id: string;
  slug: string;
  spaceName: string;
  root: string;
  docroot: string;
  port: number;
  kind: "php" | "static";
  env: WorkspaceEnv;
  /** false when detect_site fell through to its guess branch */
  confident: boolean;
  /** Windows only: root is on C: rather than inside WSL */
  slowMount: boolean;
};

export function SitesTable({
  rows,
  webHealthy,
  onDocrootChange,
  onOpen,
}: {
  rows: SiteRow[];
  webHealthy: boolean;
  onDocrootChange: (id: string, docroot: string) => void;
  onOpen: (url: string) => void;
}): React.JSX.Element {
  return (
    <TooltipProvider delayDuration={200}>
      <section className="space-y-2">
        <div>
          <h3 className="font-medium text-sm">Sites</h3>
          <p className="text-muted-foreground text-xs">
            Each Terra space is available through the local web stack.
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-4 text-muted-foreground text-xs">
            Add a Terra space to configure a site.
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => {
              const url = `http://localhost:${row.port}`;
              const kindLabel =
                row.kind === "php"
                  ? "PHP"
                  : row.confident
                    ? "Static"
                    : "Static (guess)";
              return (
                <div key={row.slug} className="space-y-1.5">
                  <div className="flex items-center gap-3 rounded-md border px-3 py-2">
                    <span className="min-w-28 font-medium text-sm">
                      {row.spaceName}
                    </span>
                    <span className="font-mono text-muted-foreground text-xs">
                      {url}
                    </span>
                    <Badge variant="outline">{kindLabel}</Badge>
                    <Input
                      aria-label={`${row.spaceName} document root`}
                      className="h-7 min-w-32 flex-1"
                      value={row.docroot}
                      onChange={(event) =>
                        onDocrootChange(row.id, event.target.value)
                      }
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!webHealthy}
                            onClick={() => onOpen(url)}
                          >
                            Open
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {!webHealthy && (
                        <TooltipContent>
                          Start the web service before opening a site preview.
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </div>
                  {row.slowMount && (
                    <p className="px-3 text-muted-foreground text-xs">
                      Slow mount: bind mounts through /mnt/c are slow for PHP's
                      many-small-file access. A WSL space avoids it.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </TooltipProvider>
  );
}
