import { Camera, Film, Images, MapPin, Trash2, Video } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { MAX_PHOTOS_PER_ROOM, uid, type FieldRoom, type RoomPhoto } from "@/lib/field/model";
import { deletePhotoBlob, prepareFromFile, savePhotoBlob } from "@/lib/field/photos";
import { getGeoTag, nativePhoto, videoPoster } from "@/lib/field/media";
import { useField } from "@/lib/field/store";

/** Largest clip we keep on the phone (IndexedDB inside the app). */
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;

/** Room photos + videos from the camera or gallery, each stamped with time and GPS (when available). */
export function PhotoSlots({
  room,
  onView,
}: {
  room: FieldRoom;
  onView: (photoId: string) => void;
}) {
  const photoCam = useRef<HTMLInputElement>(null);
  const photoLib = useRef<HTMLInputElement>(null);
  const videoCam = useRef<HTMLInputElement>(null);
  const videoLib = useRef<HTMLInputElement>(null);
  const updateRoom = useField((s) => s.updateRoom);
  const [busy, setBusy] = useState(false);
  const full = room.photos.length >= MAX_PHOTOS_PER_ROOM;

  const latest = () => useField.getState().history?.present.rooms.find((r) => r.id === room.id);

  const add = async (blob: Blob, kind: "photo" | "video") => {
    if ((latest()?.photos.length ?? MAX_PHOTOS_PER_ROOM) >= MAX_PHOTOS_PER_ROOM) return;
    setBusy(true);
    const geoP = getGeoTag();
    try {
      let entry: RoomPhoto;
      const id = uid(kind);
      if (kind === "video") {
        if (blob.size > MAX_VIDEO_BYTES) {
          toast.error("That video is too long to keep on the phone (max ~250 MB). Try a shorter clip.");
          return;
        }
        const { thumb, duration } = await videoPoster(blob);
        await savePhotoBlob(id, blob);
        entry = { id, kind, thumb, takenAt: Date.now(), mime: blob.type || "video/mp4", duration };
      } else {
        const prepared = await prepareFromFile(blob as File);
        await savePhotoBlob(id, prepared.full).catch(() => {});
        entry = { id, kind, thumb: prepared.thumb, takenAt: Date.now() };
      }
      const geo = await geoP;
      if (geo) entry.geo = geo;
      const current = latest();
      if (!current || current.photos.length >= MAX_PHOTOS_PER_ROOM) {
        void deletePhotoBlob(id).catch(() => {});
        return;
      }
      updateRoom(room.id, { photos: [...current.photos, entry] });
      toast.success(`${kind === "video" ? "Video" : "Photo"} added${geo ? " with location" : ""}`);
    } catch {
      toast.error(kind === "video" ? "Couldn't save that video" : "Couldn't read that photo");
    } finally {
      setBusy(false);
    }
  };

  const photo = async (source: "camera" | "gallery") => {
    try {
      const b = await nativePhoto(source);
      if (b === "unsupported") (source === "camera" ? photoCam : photoLib).current?.click();
      else if (b) await add(b, "photo");
    } catch {
      // Plugin trouble (permissions etc.): fall back to the system picker.
      (source === "camera" ? photoCam : photoLib).current?.click();
    }
  };

  const fileInput = (
    ref: React.RefObject<HTMLInputElement | null>,
    accept: string,
    kind: "photo" | "video",
    capture: boolean,
  ) => (
    <input
      ref={ref}
      type="file"
      accept={accept}
      {...(capture ? { capture: "environment" as const } : {})}
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) void add(f, kind);
      }}
    />
  );

  const btn =
    "flex h-14 items-center justify-center gap-2 rounded-xl bg-black/5 text-base font-semibold disabled:opacity-40";
  return (
    <div className="space-y-3">
      {room.photos.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-1 pt-2">
          {room.photos.map((ph) => (
            <div key={ph.id} className="relative shrink-0">
              <button
                type="button"
                onClick={() => onView(ph.id)}
                className="block overflow-hidden rounded-xl border border-black/10"
              >
                <img src={ph.thumb} alt={`${room.name} ${ph.kind ?? "photo"}`} className="h-24 w-32 object-cover" />
              </button>
              <div className="pointer-events-none absolute bottom-1 left-1 flex gap-1">
                {ph.kind === "video" && (
                  <span className="rounded bg-black/70 px-1 text-xs text-white">
                    <Film className="inline size-3" /> {ph.duration ? `${Math.round(ph.duration)}s` : ""}
                  </span>
                )}
                {ph.geo && (
                  <span className="rounded bg-black/70 px-1 text-xs text-white">
                    <MapPin className="inline size-3" />
                  </span>
                )}
              </div>
              <button
                type="button"
                aria-label="Remove"
                onClick={() => {
                  updateRoom(room.id, { photos: room.photos.filter((p) => p.id !== ph.id) });
                  toast("Removed", {
                    action: { label: "Undo", onClick: () => useField.getState().undo() },
                  });
                }}
                className="absolute -right-2 -top-2 flex size-11 items-center justify-center rounded-full bg-white shadow"
              >
                <Trash2 className="size-5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={full || busy} onClick={() => void photo("camera")} className={btn}>
          <Camera className="size-5" /> Take photo
        </button>
        <button type="button" disabled={full || busy} onClick={() => void photo("gallery")} className={btn}>
          <Images className="size-5" /> Photo from gallery
        </button>
        <button type="button" disabled={full || busy} onClick={() => videoCam.current?.click()} className={btn}>
          <Video className="size-5" /> Record video
        </button>
        <button type="button" disabled={full || busy} onClick={() => videoLib.current?.click()} className={btn}>
          <Film className="size-5" /> Video from gallery
        </button>
      </div>
      <p className="text-xs text-black/50">
        {busy
          ? "Saving…"
          : full
            ? `Room is full (${MAX_PHOTOS_PER_ROOM}). Remove one to add more.`
            : "Each one is stamped with the time and GPS location (if the phone allows it)."}
      </p>
      {fileInput(photoCam, "image/*", "photo", true)}
      {fileInput(photoLib, "image/*", "photo", false)}
      {fileInput(videoCam, "video/*", "video", true)}
      {fileInput(videoLib, "video/*", "video", false)}
    </div>
  );
}
