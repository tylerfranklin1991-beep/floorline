import { Capacitor, registerPlugin } from "@capacitor/core";

type FloorlineNative = {
  shareFile: (o: { name: string; mime: string; base64: string }) => Promise<void>;
};
const Native = registerPlugin<FloorlineNative>("FloorlineNative");

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
