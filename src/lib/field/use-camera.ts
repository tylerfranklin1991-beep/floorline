import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { describeCameraError, openRearCamera, stopStream, streamIsLive } from "./camera";

export type CameraStatus = "off" | "starting" | "live" | "error";

/**
 * Owns one rear-camera stream bound to a <video>. Stops old tracks before
 * opening new ones, ignores stale opens (StrictMode / fast toggles), restarts
 * when the app comes back to the foreground or a track ends, and exposes a
 * manual `start()` for the "Tap to start camera" button.
 */
export function useCamera(video: RefObject<HTMLVideoElement | null>, enabled: boolean) {
  const stream = useRef<MediaStream | null>(null);
  const gen = useRef(0);
  const [status, setStatus] = useState<CameraStatus>("off");
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    gen.current += 1;
    stopStream(stream.current);
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setStatus("off");
  }, [video]);

  const start = useCallback(async () => {
    const my = ++gen.current;
    stopStream(stream.current);
    stream.current = null;
    setStatus("starting");
    setError(null);
    try {
      const s = await openRearCamera();
      if (my !== gen.current) return stopStream(s);
      stream.current = s;
      s.getVideoTracks().forEach((t) =>
        t.addEventListener("ended", () => {
          if (my === gen.current && document.visibilityState === "visible") void start();
        }),
      );
      const v = video.current;
      if (!v) throw Object.assign(new Error("no video"), { name: "AbortError" });
      v.srcObject = s;
      try {
        await v.play();
      } catch {
        // Autoplay can be refused for a moment on resume; one retry is enough.
        await new Promise((r) => setTimeout(r, 250));
        if (my !== gen.current) return;
        await v.play();
      }
      if (my !== gen.current) return;
      setStatus("live");
    } catch (err) {
      if (my !== gen.current) return;
      stopStream(stream.current);
      stream.current = null;
      setError(describeCameraError(err).message);
      setStatus("error");
    }
  }, [video]);

  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }
    void start();
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        // Release the camera while in the background (Android takes it anyway).
        gen.current += 1;
        stopStream(stream.current);
        stream.current = null;
        setStatus("off");
      } else if (!streamIsLive(stream.current)) void start();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stop();
    };
  }, [enabled, start, stop]);

  return { status, error, start, stop };
}
