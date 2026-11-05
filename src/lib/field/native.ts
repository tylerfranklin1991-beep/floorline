import { Capacitor, registerPlugin } from "@capacitor/core";

type FloorlineNative = {
  shareFile: (o: { name: string; mime: string; base64: string }) => Promise<void>;
  ensure: () => Promise<{ granted: boolean }>;
  recognizeText: (o: { base64: string }) => Promise<OcrResult>;
};

export type OcrLine = { text: string; block: number; x: number; y: number; w: number; h: number };
export type OcrResult = { width: number; height: number; lines: OcrLine[] };

/** On-device OCR (ML Kit). Throws on the web / if unavailable. */
export async function recognizeText(blob: Blob): Promise<OcrResult> {
  if (!isNativeApp()) throw new Error("Text reading needs the Android app");
  return Native.recognizeText({ base64: await toBase64(blob) });
}
/** Registered once (registering twice logged a Capacitor warning on every start). */
export const Native = registerPlugin<FloorlineNative>("FloorlineNative");

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

async function toBase64(blob: Blob): Promise<string> {
  const url: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(",") + 1);
}

/** Hand a file to Android's share sheet (the WebView can't download blobs). */
export async function nativeShareFile(name: string, blob: Blob): Promise<void> {
  await Native.shareFile({
    name,
    mime: blob.type || "application/octet-stream",
    base64: await toBase64(blob),
  });
}
