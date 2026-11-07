/**
 * Android back button / Escape: closes the top-most open sheet first, and only
 * leaves the screen when nothing is open.
 */
import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";

type Entry = { id: number; close: () => void };
const stack: Entry[] = [];
let seq = 0;

/** While `open`, the back button calls `close` (newest registration wins). */
export function useBackClose(open: boolean, close: () => void) {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    if (!open) return;
    const e: Entry = { id: ++seq, close: () => ref.current() };
    stack.push(e);
    return () => {
      const i = stack.findIndex((x) => x.id === e.id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open]);
}

/** Close the top sheet. Returns false when nothing was open. */
export function closeTop(): boolean {
  const e = stack.pop();
  if (!e) return false;
  e.close();
  return true;
}

let installed = false;
/** `fallback` runs when no sheet is open; return false to exit the app. */
export function installBackHandler(fallback: () => boolean) {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeTop();
  });
  if (!Capacitor.isNativePlatform()) return;
  void import("@capacitor/app").then(({ App }) =>
    App.addListener("backButton", () => {
      if (closeTop()) return;
      if (fallback()) return;
      void App.exitApp();
    }),
  );
}
