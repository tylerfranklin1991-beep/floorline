export const MAX_STILLS = 8;
export const MAX_SEND = 6;
export const MAX_EDGE = 1024;
export const JPEG_QUALITY = 0.72;

export type PreparedImage = {
  mime: "image/jpeg";
  data: string;
  previewUrl: string;
};

export type MediaItem = {
  id: string;
  file: File;
  kind: "image" | "video";
  previewUrl: string;
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read that image."));
    img.src = url;
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality = JPEG_QUALITY): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("Could not encode a frame."));
        else resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

export async function resizeImageFile(file: File): Promise<PreparedImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable.");
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await canvasToJpeg(canvas);
    const data = await blobToBase64(blob);
    return { mime: "image/jpeg", data, previewUrl: URL.createObjectURL(blob) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function extractVideoFrames(file: File, count: number): Promise<PreparedImage[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Could not read that video."));
    });
    try {
      await video.play();
      video.pause();
    } catch {
      /* autoplay may be blocked; seeking can still work */
    }
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration <= 0.2) {
      throw new Error("That video is too short to sample.");
    }
    const n = Math.max(1, Math.min(count, 8));
    const times: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const t = duration * (0.12 + (0.76 * i) / Math.max(1, n - 1));
      times.push(Math.min(duration - 0.05, Math.max(0.05, t)));
    }
    const frames: PreparedImage[] = [];
    const canvas = document.createElement("canvas");
    for (const time of times) {
      await seekVideo(video, time);
      const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
      const w = Math.max(1, Math.round(video.videoWidth * scale));
      const h = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is unavailable.");
      ctx.drawImage(video, 0, 0, w, h);
      const blob = await canvasToJpeg(canvas, 0.7);
      const data = await blobToBase64(blob);
      frames.push({ mime: "image/jpeg", data, previewUrl: URL.createObjectURL(blob) });
    }
    return frames;
  } finally {
    video.src = "";
    URL.revokeObjectURL(url);
  }
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Could not sample the video."));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, 2500);
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    try {
      video.currentTime = time;
    } catch {
      cleanup();
      reject(new Error("Could not sample the video."));
    }
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function prepareForAnalysis(items: MediaItem[]): Promise<{
  images: PreparedImage[];
  sourceKind: "photos" | "video" | "mixed";
  sourceCount: number;
}> {
  const stills = items.filter((item) => item.kind === "image");
  const videos = items.filter((item) => item.kind === "video");
  const prepared: PreparedImage[] = [];

  const stillBudget = videos[0]
    ? Math.min(stills.length, Math.min(4, MAX_SEND - 2))
    : Math.min(stills.length, MAX_SEND);
  for (const item of stills.slice(0, stillBudget)) {
    prepared.push(await resizeImageFile(item.file));
  }

  const remaining = MAX_SEND - prepared.length;
  if (remaining > 0 && videos[0]) {
    const frames = await extractVideoFrames(videos[0].file, remaining);
    prepared.push(...frames);
  }

  if (prepared.length === 0) {
    throw new Error("Add at least one photo or video.");
  }

  const sourceKind =
    stills.length > 0 && videos.length > 0 ? "mixed" : videos.length > 0 ? "video" : "photos";

  return { images: prepared, sourceKind, sourceCount: items.length };
}

export function filesToMedia(files: FileList | File[]): MediaItem[] {
  const list = Array.from(files);
  const items: MediaItem[] = [];
  for (const file of list) {
    const isImage = file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(file.name);
    const isVideo = file.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(file.name);
    if (!isImage && !isVideo) continue;
    items.push({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 6)}`,
      file,
      kind: isImage ? "image" : "video",
      previewUrl: URL.createObjectURL(file),
    });
  }
  return items;
}
