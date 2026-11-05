/**
 * Room photos & videos: camera / gallery pickers (Capacitor Camera on the
 * phone, file inputs on the web), video poster frames, and GPS tags.
 * Every step degrades gracefully: no permission / weak GPS = no tag, never an error.
 */
import { Capacitor } from "@capacitor/core";
import type { GeoTag } from "./model";

export const isNative = () => Capacitor.isNativePlatform();

/** Best-effort GPS fix. Resolves undefined when denied, off, or too slow. */
export async function getGeoTag(timeoutMs = 8000): Promise<GeoTag | undefined> {
  const toTag = (c: { latitude: number; longitude: number; accuracy?: number | null }) => ({
    lat: c.latitude,
    lng: c.longitude,
    ...(c.accuracy != null ? { accuracy: Math.round(c.accuracy) } : {}),
    at: Date.now(),
  });
  try {
    if (isNative()) {
      const { Geolocation } = await import("@capacitor/geolocation");
      let perm = await Geolocation.checkPermissions().catch(() => null);
      if (perm && perm.location !== "granted" && perm.coarseLocation !== "granted")
        perm = await Geolocation.requestPermissions().catch(() => null);
      if (!perm || (perm.location !== "granted" && perm.coarseLocation !== "granted")) return undefined;
      try {
        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: timeoutMs,
          maximumAge: 60_000,
        });
        return toTag(pos.coords);
      } catch {
        // Weak signal indoors: accept a coarse / older fix instead.
        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: false,
          timeout: 5000,
          maximumAge: 10 * 60_000,
        });
        return toTag(pos.coords);
      }
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) return undefined;
    return await new Promise<GeoTag | undefined>((resolve) =>
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(toTag(p.coords)),
        () => resolve(undefined),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
      ),
    );
  } catch {
    return undefined;
  }
}

export function formatGeo(g: GeoTag): string {
  return `${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}${g.accuracy != null ? ` (±${g.accuracy} m)` : ""}`;
}

export function mapsUrl(g: GeoTag): string {
  return `https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lng}`;
}

/**
 * Take or pick a photo with the native Camera plugin. Returns null when the
 * user cancels, or "unsupported" on the web (callers fall back to a file input).
 */
export async function nativePhoto(source: "camera" | "gallery"): Promise<Blob | null | "unsupported"> {
  if (!isNative()) return "unsupported";
  const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
  try {
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.Uri,
      source: source === "camera" ? CameraSource.Camera : CameraSource.Photos,
      quality: 85,
      correctOrientation: true,
      saveToGallery: false,
      width: 2400,
    });
    if (!photo.webPath) return null;
    return await (await fetch(photo.webPath)).blob();
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).toLowerCase();
    if (msg.includes("cancel")) return null;
    throw err;
  }
}

/** Poster frame + duration for a video clip (thumb has a ▶ badge). */
export async function videoPoster(blob: Blob): Promise<{ thumb: string; duration?: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error("timeout")), 10_000);
      v.onloadeddata = () => (clearTimeout(t), res());
      v.onerror = () => (clearTimeout(t), rej(new Error("decode")));
    });
    const duration = Number.isFinite(v.duration) ? v.duration : undefined;
    await new Promise<void>((res) => {
      const t = setTimeout(res, 2500);
      v.onseeked = () => (clearTimeout(t), res());
      v.currentTime = Math.min(0.5, (duration ?? 1) / 2);
    });
    return { thumb: posterCanvas(v, v.videoWidth, v.videoHeight), duration };
  } catch {
    return { thumb: posterCanvas(null, 220, 165) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function posterCanvas(src: HTMLVideoElement | null, w: number, h: number): string {
  const scale = Math.min(1, 220 / Math.max(w || 1, h || 1));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round((w || 220) * scale));
  c.height = Math.max(1, Math.round((h || 165) * scale));
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#1c1b18";
  ctx.fillRect(0, 0, c.width, c.height);
  if (src) {
    try {
      ctx.drawImage(src, 0, 0, c.width, c.height);
    } catch {
      /* keep dark poster */
    }
  }
  const r = Math.min(c.width, c.height) * 0.22;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.arc(c.width / 2, c.height / 2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(c.width / 2 - r * 0.35, c.height / 2 - r * 0.5);
  ctx.lineTo(c.width / 2 + r * 0.55, c.height / 2);
  ctx.lineTo(c.width / 2 - r * 0.35, c.height / 2 + r * 0.5);
  ctx.fill();
  return c.toDataURL("image/jpeg", 0.7);
}

/** System file picker as a promise (resolves null if nothing chosen). */
export function pickFile(accept: string, camera = false): Promise<File | null> {
  return new Promise((resolve) => {
    const i = document.createElement("input");
    i.type = "file";
    i.accept = accept;
    if (camera) i.setAttribute("capture", "environment");
    i.onchange = () => resolve(i.files?.[0] ?? null);
    i.addEventListener("cancel", () => resolve(null));
    i.click();
  });
}

/** A photo from the camera or gallery: native Camera plugin, file picker fallback. */
export async function pickImage(source: "camera" | "gallery"): Promise<Blob | null> {
  try {
    const b = await nativePhoto(source);
    if (b !== "unsupported") return b;
  } catch {
    /* fall through to the picker */
  }
  return pickFile("image/*", source === "camera");
}

/** Decode + downscale an image to a JPEG (max edge), returning its size. */
export async function scaleImage(
  blob: Blob,
  maxEdge = 1600,
): Promise<{ blob: Blob; w: number; h: number; img: HTMLCanvasElement }> {
  const url = URL.createObjectURL(blob);
  try {
    const im = new Image();
    im.src = url;
    await im.decode();
    const k = Math.min(1, maxEdge / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(im.naturalWidth * k));
    c.height = Math.max(1, Math.round(im.naturalHeight * k));
    c.getContext("2d")!.drawImage(im, 0, 0, c.width, c.height);
    const out = await new Promise<Blob>((res, rej) =>
      c.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", 0.85),
    );
    return { blob: out, w: c.width, h: c.height, img: c };
  } finally {
    URL.revokeObjectURL(url);
  }
}
