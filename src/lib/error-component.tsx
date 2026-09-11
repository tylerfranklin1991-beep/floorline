import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

const FALLBACK_MESSAGE = "An unexpected error occurred. Try reloading the page.";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return FALLBACK_MESSAGE;
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
      <span className="text-destructive" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="font-display text-2xl">Something went wrong</h1>
      <p className="max-w-md text-sm leading-relaxed text-pretty text-muted-foreground">{errorMessage(error)}</p>
      <button
        type="button"
        className="inline-flex h-11 min-w-40 items-center justify-center rounded-md bg-paper px-4 text-sm font-medium text-ink"
        onClick={() => {
          try {
            window.localStorage.removeItem("floorline-v1");
            window.localStorage.removeItem("floorline-v2");
          } catch {
            /* ignore */
          }
          window.location.assign("/");
        }}
      >
        Start over
      </button>
    </main>
  );
}
