/**
 * Camera access with honest error messages.
 *
 * The old guided walk raced getUserMedia against an 800 ms timer, so on a
 * phone the permission prompt alone was enough to "fail" and drop the user
 * into a fake sample home. Here we wait for the user and explain what went
 * wrong when it really does fail.
 */
export type CameraError = {
  code: "insecure" | "unsupported" | "denied" | "busy" | "none" | "unknown";
  message: string;
};

export function describeCameraError(err: unknown): CameraError {
  const name =
    err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return {
      code: "insecure",
      message: "The camera only works over HTTPS. Open the app's https:// link.",
    };
  }
  if (name === "NotAllowedError" || name === "SecurityError")
    return {
      code: "denied",
      message:
        "Camera permission is blocked. Tap the lock icon in the address bar → Permissions → Camera → Allow, then try again.",
    };
  if (name === "NotReadableError" || name === "AbortError")
    return { code: "busy", message: "Another app is using the camera. Close it and try again." };
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return { code: "none", message: "No camera was found on this device." };
  if (name === "unsupported")
    return { code: "unsupported", message: "This browser can't open the camera. Try Chrome." };
  return {
    code: "unknown",
    message: "Couldn't start the camera. Try again, or draw the room instead.",
  };
}

export async function openRearCamera(): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("unsupported"), { name: "unsupported" });
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "OverconstrainedError") {
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    throw err;
  }
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}
