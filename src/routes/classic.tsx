import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Landing } from "@/components/landing";
import { ProcessingOverlay } from "@/components/processing";
import { Studio } from "@/components/studio";
import { usePlanStore } from "@/lib/floorplan/store";

export const Route = createFileRoute("/classic")({ component: Home });

function Home() {
  const view = usePlanStore((s) => s.view);
  const plan = usePlanStore((s) => s.plan);
  const status = usePlanStore((s) => s.status);
  const statusDetail = usePlanStore((s) => s.statusDetail);
  const surveyFrames = usePlanStore((s) => s.surveyFrames);
  const setHydrated = usePlanStore((s) => s.setHydrated);
  const cancelWork = usePlanStore((s) => s.cancelWork);

  useEffect(() => {
    const unsub = usePlanStore.persist.onFinishHydration(() => setHydrated(true));
    if (usePlanStore.persist.hasHydrated()) setHydrated(true);
    const fallback = window.setTimeout(() => setHydrated(true), 600);
    return () => {
      unsub();
      window.clearTimeout(fallback);
    };
  }, [setHydrated]);

  useEffect(() => {
    if (status !== "preparing" && status !== "analyzing") return;
    const timer = window.setTimeout(() => cancelWork(), 50000);
    return () => window.clearTimeout(timer);
  }, [status, cancelWork]);

  const busy = status === "preparing" || status === "analyzing";

  return (
    <>
      {view === "studio" && plan ? <Studio /> : <Landing />}
      {busy && (
        <ProcessingOverlay
          phase={status}
          detail={statusDetail}
          frames={surveyFrames}
          onCancel={cancelWork}
        />
      )}
    </>
  );
}
