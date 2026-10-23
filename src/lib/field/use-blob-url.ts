import { useEffect, useState } from "react";
import { loadPhotoBlob } from "./photos";

/** Object URL for an IndexedDB image (revoked when the id changes / unmounts). */
export function useBlobUrl(id: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!id) return;
    let u: string | null = null;
    let live = true;
    void loadPhotoBlob(id)
      .then((b) => {
        if (b && live) {
          u = URL.createObjectURL(b);
          setUrl(u);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  return url;
}
