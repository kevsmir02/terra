import { type ComponentProps, lazy, Suspense } from "react";
import type { TurnChangesDialog as Inner } from "./TurnChangesDialog";

const TurnChangesDialogInner = lazy(() =>
  import("./TurnChangesDialog").then((m) => ({
    default: m.TurnChangesDialog,
  })),
);

/** Callers mount this on the first request, so the dialog and its IPC load
 * then rather than at startup. */
export function TurnChangesDialog(props: ComponentProps<typeof Inner>) {
  return (
    <Suspense fallback={null}>
      <TurnChangesDialogInner {...props} />
    </Suspense>
  );
}
