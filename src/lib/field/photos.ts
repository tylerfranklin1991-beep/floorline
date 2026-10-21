/**
 * Room photos. Full-size JPEGs live in IndexedDB (big, offline); a small
 * thumbnail data URL is stored on the room itself so the diagram and exports
 * always have something to show.
 */
const DB = "floorline-photos";
const STORE = "photos";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const savePhotoBlob = (id: string, blob: Blob) => tx("readwrite", (s) => s.put(blob, id));
export const loadPhotoBlob = (id: string) => tx<Blob | undefined>("readonly", (s) => s.get(id));
export const deletePhotoBlob = (id: string) => tx("readwrite", (s) => s.delete(id));

function draw(source: CanvasImageSource, sw: number, sh: number, maxEdge: number, quality: number) {
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return {
    dataUrl: () => canvas.toDataURL("image/jpeg", quality),
    blob: () =>
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Encode failed"))),
          "image/jpeg",
          quality,
        ),
      ),
  };
}

export type PreparedPhoto = { full: Blob; thumb: string };

export async function prepareFromSource(
  source: HTMLVideoElement | HTMLImageElement,
): Promise<PreparedPhoto> {
  const w = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
  const h = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
  if (!w || !h) throw new Error("Camera not ready yet");
  const full = await draw(source, w, h, 1600, 0.82).blob();
  const thumb = draw(source, w, h, 220, 0.7).dataUrl();
  return { full, thumb };
}

export async function prepareFromFile(file: File): Promise<PreparedPhoto> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await prepareFromSource(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}
