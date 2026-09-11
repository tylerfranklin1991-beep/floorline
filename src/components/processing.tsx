import { useEffect, useState } from "react";
import { SAMPLE_PLAN } from "@/lib/floorplan/sample";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

const STEPS = [
  { id: "preparing", label: "Reading frames" },
  { id: "analyzing", label: "Finding walls" },
  { id: "rooms", label: "Sketching rooms" },
  { id: "sheet", label: "Inking the sheet" },
];

function LiveSketch() {
  return (
    <svg viewBox="-1.5 -1.5 33 32" className="live-sketch" aria-hidden="true">
      {SAMPLE_PLAN.rooms.map((room, index) => (
        <rect
          key={room.id}
          x={room.x}
          y={room.y}
          width={room.w}
          height={room.h}
          pathLength={1}
          className="live-sketch-wall"
          style={{ ["--sketch-i" as string]: index }}
        />
      ))}
    </svg>
  );
}

export function ProcessingOverlay({
  phase,
  detail,
  frames = [],
  onCancel,
}: {
  phase: "preparing" | "analyzing";
  detail?: string;
  frames?: string[];
  onCancel?: () => void;
}) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (phase !== "analyzing") {
      setTick(0);
      return;
    }
    const timer = window.setInterval(() => {
      setTick((value) => Math.min(value + 1, 2));
    }, 4800);
    return () => window.clearInterval(timer);
  }, [phase]);

  const active = phase === "preparing" ? 0 : Math.min(3, 1 + tick);

  return (
    <div
      className="process-overlay pointer-events-auto fixed inset-0 z-40 flex bg-background/80"
      role="dialog"
      aria-modal="true"
      aria-labelledby="process-title"
      onClick={onCancel}
    >
      <div
        className="process-sheet pointer-events-auto w-full max-w-md border border-border bg-card p-6 pb-safe-lg shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-foreground)_6%,transparent)]"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">Auto sketch</p>
        <h2 id="process-title" className="mt-3 font-display text-3xl leading-tight text-balance text-foreground">
          {detail || STEPS[active]?.label}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-pretty text-muted-foreground">
          The diagram sketches itself from the walk — walls first, then doors, then furniture.
        </p>
        <div className="live-sketch-frame mt-5">
          <LiveSketch />
        </div>
        {frames.length > 0 && (
          <ul className="mt-4 flex gap-2 overflow-x-auto">
            {frames.map((src) => (
              <li key={src} className="size-14 shrink-0 overflow-hidden rounded-md bg-secondary">
                <img src={src} alt="" className="plain-image size-full object-cover" />
              </li>
            ))}
          </ul>
        )}
        <ol className="mt-6 space-y-2">
          {STEPS.map((step, index) => {
            const done = index < active;
            const current = index === active;
            return (
              <li key={step.id} className="flex items-center gap-3 text-sm">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    current ? "bg-accent" : done ? "bg-foreground/50" : "bg-border",
                  )}
                />
                <span className={current ? "text-foreground" : "text-muted-foreground"}>{step.label}</span>
              </li>
            );
          })}
        </ol>
        {onCancel && (
          <Button type="button" variant="outline" className="mt-6 h-12 w-full tap-target" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
