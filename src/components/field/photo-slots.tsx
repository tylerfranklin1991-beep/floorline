import { Camera, Trash2 } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { MAX_PHOTOS_PER_ROOM, uid, type FieldRoom } from "@/lib/field/model";
import { deletePhotoBlob, prepareFromFile, savePhotoBlob } from "@/lib/field/photos";
import { useField } from "@/lib/field/store";

/** Up to 2 photos per room, taken with the phone's own camera app (most reliable on Android). */
export function PhotoSlots({
  room,
  onView,
}: {
  room: FieldRoom;
  onView: (photoId: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const updateRoom = useField((s) => s.updateRoom);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const prepared = await prepareFromFile(file);
      const id = uid("photo");
      await savePhotoBlob(id, prepared.full).catch(() => {});
      const current = useField.getState().history?.present.rooms.find((r) => r.id === room.id);
      if (!current) return;
      updateRoom(room.id, {
        photos: [...current.photos, { id, thumb: prepared.thumb, takenAt: Date.now() }].slice(
          0,
          MAX_PHOTOS_PER_ROOM,
        ),
      });
    } catch {
      toast.error("Couldn't read that photo");
    }
  };

  return (
    <div className="flex gap-3">
      {room.photos.map((ph) => (
        <div key={ph.id} className="relative">
          <button
            type="button"
            onClick={() => onView(ph.id)}
            className="block overflow-hidden rounded-xl border border-black/10"
          >
            <img src={ph.thumb} alt={`${room.name} photo`} className="h-24 w-32 object-cover" />
          </button>
          <button
            type="button"
            aria-label="Remove photo"
            onClick={() => {
              updateRoom(room.id, { photos: room.photos.filter((p) => p.id !== ph.id) });
              void deletePhotoBlob(ph.id).catch(() => {});
            }}
            className="absolute -right-2 -top-2 flex size-9 items-center justify-center rounded-full bg-white shadow"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      {room.photos.length < MAX_PHOTOS_PER_ROOM && (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex h-24 w-32 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-black/25 text-base font-semibold"
        >
          <Camera className="size-7" />
          Add photo
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
