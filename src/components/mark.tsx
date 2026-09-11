import { cn } from "@/lib/utils";

export function FloorlineMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
        <rect x="1" y="1" width="30" height="30" rx="7" className="fill-secondary" />
        <path
          d="M8 8h10v8H8zM18 8h6v16H12v-8h6z"
          className="fill-none stroke-accent"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M11 22h5v2H11z" className="fill-accent" />
      </svg>
      <span className="font-display text-xl tracking-tight text-foreground">Floorline</span>
    </span>
  );
}
