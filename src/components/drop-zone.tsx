import { Camera, Compass, ImageIcon, Video, X } from "lucide-react";
import { forwardRef, useId, useImperativeHandle, useRef, useState } from "react";
import type { MediaItem } from "@/lib/floorplan/media";
import { filesToMedia, MAX_STILLS } from "@/lib/floorplan/media";
import type { SurveySite } from "@/lib/floorplan/types";
import { cn } from "@/lib/utils";
import { CaptureModal, type CaptureMode } from "./capture";
import { GuideWalk } from "./guide-walk";
import { Button } from "./ui/button";

type Props = {
  items: MediaItem[];
  onChange: (items: MediaItem[]) => void;
  disabled?: boolean;
  onGuidedComplete?: (files: File[], hint: string, site: SurveySite) => void;
  onGuidedPreview?: (hint: string, site: SurveySite) => void;
};

export type DropZoneHandle = {
  openPhotos: () => void;
  openCamera: () => void;
  openWalk: () => void;
};

export const DropZone = forwardRef<DropZoneHandle, Props>(function DropZone(
  { items, onChange, disabled, onGuidedComplete, onGuidedPreview },
  ref,
) {
  const photosId = useId();
  const cameraId = useId();
  const videoId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const videoCaptureRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<CaptureMode>("stills");
  const [guideOpen, setGuideOpen] = useState(false);

  const stills = items.filter((item) => item.kind === "image").length;
  const videos = items.filter((item) => item.kind === "video").length;
  const remainingStills = Math.max(0, MAX_STILLS - stills);

  const addFiles = (list: FileList | File[]) => {
    const incoming = filesToMedia(list);
    if (incoming.length === 0) return;
    const merged = [...items];
    let stillCount = stills;
    let videoCount = videos;
    for (const item of incoming) {
      if (item.kind === "image") {
        if (stillCount >= MAX_STILLS) continue;
        stillCount += 1;
        merged.push(item);
      } else {
        if (videoCount >= 1) continue;
        videoCount += 1;
        merged.push(item);
      }
    }
    onChange(merged);
  };

  const isCoarse = () => window.matchMedia("(pointer: coarse)").matches;

  const openCamera = () => {
    if (disabled || remainingStills === 0) return;
    if (isCoarse()) cameraRef.current?.click();
    else {
      setCameraMode("stills");
      setCameraOpen(true);
    }
  };

  const openVideo = () => {
    if (disabled || videos >= 1) return;
    if (isCoarse()) videoCaptureRef.current?.click();
    else {
      setCameraMode("video");
      setCameraOpen(true);
    }
  };

  const openGuide = () => {
    if (disabled || videos >= 1) return;
    setGuideOpen(true);
  };

  useImperativeHandle(ref, () => ({
    openPhotos: () => {
      if (!disabled) inputRef.current?.click();
    },
    openCamera,
    openWalk: openGuide,
  }));

  const tileClass =
    "pointer-events-auto flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm text-foreground disabled:opacity-50";

  return (
    <div className="relative z-10 flex flex-col gap-3">
      <input
        id={photosId}
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        suppressHydrationWarning
        className="sr-only pointer-events-none"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          if (event.target.files) addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        id={cameraId}
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        suppressHydrationWarning
        className="sr-only pointer-events-none"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          if (event.target.files) addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        id={videoId}
        ref={videoCaptureRef}
        type="file"
        accept="video/*"
        capture="environment"
        suppressHydrationWarning
        className="sr-only pointer-events-none"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          if (event.target.files) addFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <div className="capture-tiles relative z-10">
        <button type="button" disabled={Boolean(disabled)} onClick={() => inputRef.current?.click()} className={tileClass}>
          <span className="flex size-11 items-center justify-center rounded-lg bg-secondary text-accent">
            <ImageIcon className="size-5" />
          </span>
          Photos
        </button>
        <button type="button" disabled={Boolean(disabled || remainingStills === 0)} onClick={openCamera} className={tileClass}>
          <span className="flex size-11 items-center justify-center rounded-lg bg-secondary text-accent">
            <Camera className="size-5" />
          </span>
          Camera
        </button>
        <button type="button" disabled={Boolean(disabled || videos >= 1)} onClick={openGuide} className={tileClass}>
          <span className="flex size-11 items-center justify-center rounded-lg bg-secondary text-accent">
            <Compass className="size-5" />
          </span>
          Walk
        </button>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          if (event.dataTransfer.files) addFiles(event.dataTransfer.files);
        }}
        className={cn(
          "group drop-desk relative z-10 min-h-52 w-full flex-col items-start justify-between overflow-hidden rounded-2xl border border-dashed p-5 text-left transition-[border-color,background-color] duration-200",
          over ? "border-accent bg-secondary/80" : "border-border bg-card/60 hover:border-accent/50 hover:bg-card",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <span className="flex size-11 items-center justify-center rounded-lg bg-secondary text-accent">
          <ImageIcon className="size-5" />
        </span>
        <div className="mt-8">
          <p className="font-display text-2xl leading-tight text-balance text-foreground">Drop a walkthrough</p>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-pretty text-muted-foreground">
            Photos or a short video of the space. Or tap Walk — we’ll prompt you, film it, and draw the plan on its
            own.
          </p>
        </div>
      </button>

      <div className="drop-desk-actions relative z-10">
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={disabled}>
          Add files
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={openCamera} disabled={disabled || remainingStills === 0}>
          <Camera className="size-4" />
          Use camera
        </Button>
        <Button type="button" variant="paper" size="sm" onClick={openGuide} disabled={disabled || videos >= 1}>
          <Compass className="size-4" />
          Guided walk
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={openVideo} disabled={disabled || videos >= 1}>
          <Video className="size-4" />
          Record video
        </Button>
      </div>

      {items.length > 0 && (
        <ul className="media-thumbs">
          {items.map((item) => (
            <li key={item.id} className="relative aspect-square overflow-hidden rounded-lg bg-secondary">
              {item.kind === "image" ? (
                <img src={item.previewUrl} alt="" className="plain-image size-full object-cover" />
              ) : (
                <video src={item.previewUrl} muted playsInline preload="metadata" className="size-full object-cover" />
              )}
              <Button
                type="button"
                size="icon-sm"
                variant="inverse"
                className="remove-thumb absolute top-1 right-1 rounded-full"
                onClick={() => {
                  URL.revokeObjectURL(item.previewUrl);
                  onChange(items.filter((entry) => entry.id !== item.id));
                }}
                aria-label="Remove file"
              >
                <X className="size-3.5" />
              </Button>
              {item.kind === "video" && (
                <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded-sm bg-background/80 px-1.5 py-0.5 text-xs font-medium tracking-wide text-foreground uppercase">
                  <Video className="size-3" />
                  Video
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {cameraOpen && (
        <CaptureModal
          remaining={remainingStills}
          initialMode={cameraMode}
          onClose={() => setCameraOpen(false)}
          onCapture={(files) => addFiles(files)}
        />
      )}
      {guideOpen && (
        <GuideWalk
          onClose={() => setGuideOpen(false)}
          onComplete={(files, hint, site) => {
            setGuideOpen(false);
            if (onGuidedComplete) onGuidedComplete(files, hint, site);
            else addFiles(files);
          }}
          onPreviewComplete={(hint, site) => {
            setGuideOpen(false);
            onGuidedPreview?.(hint, site);
          }}
        />
      )}
    </div>
  );
});
