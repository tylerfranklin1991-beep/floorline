export type LiveStatus = "ok" | "slow" | "hold" | "tilt" | "dark";

export type LiveMetrics = {
  motion: number;
  tooFast: boolean;
  stable: boolean;
  tiltDown: boolean;
  dark: boolean;
  status: LiveStatus;
  prompt: string;
};

const EMPTY: LiveMetrics = {
  motion: 0,
  tooFast: false,
  stable: false,
  tiltDown: false,
  dark: false,
  status: "ok",
  prompt: "",
};

export function emptyMetrics(): LiveMetrics {
  return EMPTY;
}

export function metricsFromFrames(prev: ImageData | null, curr: ImageData): LiveMetrics {
  const data = curr.data;
  const n = data.length / 4;
  if (n === 0) return EMPTY;

  let lum = 0;
  let top = 0;
  let bot = 0;
  let topN = 0;
  let botN = 0;
  const h = curr.height;
  const w = curr.width;
  const third = Math.floor(h / 3);

  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    const y = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    lum += y;
    const row = Math.floor(i / w);
    if (row < third) {
      top += y;
      topN += 1;
    } else if (row >= h - third) {
      bot += y;
      botN += 1;
    }
  }

  const mean = lum / n;
  const topMean = topN ? top / topN : mean;
  const botMean = botN ? bot / botN : mean;

  let motion = 0;
  if (prev && prev.data.length === data.length) {
    let acc = 0;
    const step = 16;
    for (let i = 0; i < data.length; i += step) {
      acc += Math.abs(data[i] - prev.data[i]);
    }
    motion = Math.min(1, acc / ((data.length / step) * 48));
  }

  const tooFast = motion > 0.22;
  const stable = motion < 0.05;
  const tiltDown = topMean > botMean * 1.38 && topMean > 80;
  const dark = mean < 26;

  let status: LiveStatus = "ok";
  let prompt = "";
  if (tooFast) {
    status = "slow";
    prompt = "A little slower — we need a clear look at the walls.";
  } else if (dark) {
    status = "dark";
    prompt = "It's a bit dark. Face a window if you can.";
  } else if (tiltDown) {
    status = "tilt";
    prompt = "Tip the phone down a little so we can see the floor.";
  }

  return { motion, tooFast, stable, tiltDown, dark, status, prompt };
}

export function cueDirection(text: string): "left" | "right" | "up" | "down" | "hold" | null {
  const t = text.toLowerCase();
  if (/\bhold still\b|\bstay still\b/.test(t)) return "hold";
  if (/\btip (the phone )?down\b|\btilt down\b/.test(t)) return "down";
  if (/\btip (the phone )?up\b|\btilt up\b/.test(t)) return "up";
  if (/\bpan left\b|\bto the left\b/.test(t)) return "left";
  if (/\bpan right\b|\bto the right\b/.test(t)) return "right";
  return null;
}

export async function encodeFrame(
  source: CanvasImageSource,
  maxEdge = 512,
  quality = 0.58,
): Promise<{ data: string; mime: "image/jpeg" } | null> {
  const canvas = document.createElement("canvas");
  const width =
    "videoWidth" in source && source.videoWidth
      ? source.videoWidth
      : "naturalWidth" in source
        ? source.naturalWidth
        : 0;
  const height =
    "videoHeight" in source && source.videoHeight
      ? source.videoHeight
      : "naturalHeight" in source
        ? source.naturalHeight
        : 0;
  if (!width || !height) return null;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) return null;
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return { mime: "image/jpeg", data: btoa(binary) };
}

export const MAX_COACH_CALLS = 8;
export const COACH_GAP_MS = 4200;
