import { lazy, Suspense } from "react";

const UpdaterDialogInner = lazy(() =>
  import("./UpdaterDialog").then((m) => ({ default: m.UpdaterDialog })),
);

/**
 * The updater dialog and its @tauri-apps/plugin-updater dependency are only
 * ever needed once an update exists, which is never on a cold start. Rendering
 * the inner element behind Suspense is what keeps that chunk out of the
 * startup preload set; a static import here would defeat the whole wrapper.
 */
export function UpdaterDialog() {
  return (
    <Suspense fallback={null}>
      <UpdaterDialogInner />
    </Suspense>
  );
}
