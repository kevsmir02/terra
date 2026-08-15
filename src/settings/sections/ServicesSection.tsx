import { RuntimeCard, type RuntimeStatus } from "@/modules/services";
import { useState } from "react";

export function ServicesSection() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const ready = status?.state === "ready";

  return (
    <div className="space-y-4">
      <RuntimeCard onStatus={setStatus} />
      {!ready && (
        <p className="text-muted-foreground text-xs">
          Services become available once a container runtime is ready.
        </p>
      )}
    </div>
  );
}
