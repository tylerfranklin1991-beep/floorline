/**
 * Camera access with honest error messages, retries and clean track lifecycle.
 *
 * Android WebView (Capacitor) notes:
 *  - The CAMERA runtime permission is requested natively first (CameraPermission
 *    plugin) so getUserMedia never races the system dialog.
 *  - Only one stream may own the camera: always stop the previous tracks
 *    before opening new ones, or the next open fails with NotReadableError.
 *  - Tracks end when the app goes to the background; callers must reopen on
 *    resume (see useCamera).
 */
import { Capacitor } from "@capacitor/core";
import { Native } from "./native.ts";

export type CameraError = {
  code: "insecure" | "unsupported" | "denied" | "busy" | "none" | "unknown";
  message: string;
};

const isNative = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

export function describeCameraError(err: unknown, native = isNative()): CameraError {
  const name =
    err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  if (!native && typeof window !== "undefined" && window.isSecureContext === false) {
    return {
      code: "insecure",
      message: "The camera only works over HTTPS. Open the app's https:// link.",
    };
  }
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDenied")
    return {
      code: "denied",
      message: native
        ? "Camera permission is off. Open Android Settings → Apps → Floorline → Permissions → Camera → Allow, then tap Retry."
        : "Camera permission is blocked. Tap the lock icon in the address bar → Permissions → Camera → Allow, then try again.",
    };
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError")
    return {
      code: "busy",
      message: "The camera is busy (another app may be using it). Close it and tap Retry.",
    };
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return { code: "none", message: "No camera was found on this device." };
  if (name === "unsupported")
    return { code: "unsupported", message: "This browser can't open the camera. Try Chrome." };
  return { code: "unknown", message: "Couldn't start the camera. Tap Retry." };
}

const CameraPermission = Native;

/** Native runtime permission (no-op on the web, where the browser prompts). */
export async function ensureCameraPermission(): Promise<boolean> {
  if (!isNative()) return true;
  try {
    return (await CameraPermission.ensure()).granted;
  } catch {
    // Older builds without the plugin: fall back to the WebView's own prompt.
    return true;
  }
}

/** Constraint ladder: back camera at HD, back camera any size, any camera. */
export const CONSTRAINT_LADDER: MediaStreamConstraints[] = [
  {
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  },
  { video: { facingMode: "environment" }, audio: false },
  { video: true, audio: false },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Open the rear camera, walking down the constraint ladder. A busy camera
 * (often our own just-stopped stream still releasing) is retried after a pause.
 */
export async function openRearCamera(
  gumArg?: (c: MediaStreamConstraints) => Promise<MediaStream>,
  opts: { busyRetries?: number; busyDelayMs?: number } = {},
): Promise<MediaStream> {
  let gum = gumArg;
  if (!gum) {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia)
      throw Object.assign(new Error("unsupported"), { name: "unsupported" });
    gum = (c) => navigator.mediaDevices.getUserMedia(c);
  }
  if (!(await ensureCameraPermission()))
    throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
  let busyLeft = opts.busyRetries ?? 2;
  let last: unknown = null;
  for (let i = 0; i < CONSTRAINT_LADDER.length; i += 1) {
    try {
      return await gum(CONSTRAINT_LADDER[i]);
    } catch (err) {
      last = err;
      const name = (err as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "SecurityError") throw err;
      if ((name === "NotReadableError" || name === "AbortError") && busyLeft > 0) {
        busyLeft -= 1;
        await sleep(opts.busyDelayMs ?? 400);
        i -= 1; // same rung again
      }
    }
  }
  throw last;
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {
      /* already stopped */
    }
  });
}

export function streamIsLive(stream: MediaStream | null | undefined): boolean {
  return !!stream && stream.getVideoTracks().some((t) => t.readyState === "live");
}
