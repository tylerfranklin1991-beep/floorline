import { Camera, Square, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui/button";

export type CaptureMode = "stills" | "video";

type Props = {
  onClose: () => void;
  onCapture: (files: File[]) => void;
  remaining: number;
  initialMode?: CaptureMode;
};

const MAX_RECORD_S = 20;

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  return types.find((type) => MediaRecorder.isTypeSupported(type));
}

export function CaptureModal({ onClose, onCapture, remaining, initialMode = "stills" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stillsRef = useRef<File[]>([]);
  const videoFileRef = useRef<File | null>(null);
  const snapsRef = useRef<string[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const clipRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snaps, setSnaps] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<CaptureMode>(initialMode);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  snapsRef.current = snaps;
  clipRef.current = clipUrl;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1440 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
          setReady(true);
        }
      } catch {
        if (!cancelled) {
          setError("Camera access was blocked. Drop photos or a video instead.");
        }
      }
    })();
    return () => {
      cancelled = true;
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      for (const url of snapsRef.current) URL.revokeObjectURL(url);
      if (clipRef.current) URL.revokeObjectURL(clipRef.current);
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const interval = window.setInterval(() => {
      setElapsed((value) => value + 1);
    }, 1000);
    const limit = window.setTimeout(() => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      setRecording(false);
    }, MAX_RECORD_S * 1000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(limit);
    };
  }, [recording]);

  const snap = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    if (stillsRef.current.length >= remaining) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (!blob) return;
    const file = new File([blob], `still-${Date.now()}.jpg`, { type: "image/jpeg" });
    stillsRef.current = [...stillsRef.current, file];
    setSnaps((current) => [...current, URL.createObjectURL(blob)]);
  };

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream || recording) return;
    const mime = pickRecorderMime();
    if (!mime || typeof MediaRecorder === "undefined") {
      setError("Video recording is not available here. Drop a clip instead.");
      return;
    }
    if (clipUrl) {
      URL.revokeObjectURL(clipUrl);
      setClipUrl(null);
    }
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      const file = new File([blob], `walkthrough-${Date.now()}.${ext}`, { type: blob.type });
      videoFileRef.current = file;
      setClipUrl(URL.createObjectURL(blob));
      recorderRef.current = null;
    };
    recorder.start(250);
    recorderRef.current = recorder;
    setElapsed(0);
    setRecording(true);
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setRecording(false);
  };

  const finish = () => {
    if (mode === "video" && videoFileRef.current) onCapture([videoFileRef.current]);
    else if (mode === "stills") onCapture(stillsRef.current);
    onClose();
  };

  const timer = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  return createPortal(
    <div className="capture-overlay fixed inset-0 z-40 flex bg-background/80">
      <div className="capture-sheet w-full max-w-lg overflow-hidden border border-border bg-card pb-safe">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Live camera</p>
          <Button type="button" size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close camera">
            <X className="size-4" />
          </Button>
        </div>
        <div className="px-4 pb-3">
          <div className="flex rounded-lg bg-secondary p-1">
            {(["stills", "video"] as CaptureMode[]).map((entry) => (
              <button
                key={entry}
                type="button"
                disabled={recording}
                onClick={() => setMode(entry)}
                className={`h-11 flex-1 rounded-md text-sm ${
                  mode === entry ? "bg-background text-foreground" : "text-muted-foreground"
                }`}
              >
                {entry === "stills" ? "Stills" : "Video"}
              </button>
            ))}
          </div>
        </div>
        <div className="relative aspect-[4/3] bg-desk">
          <video
            ref={videoRef}
            muted
            playsInline
            className={`size-full object-cover ${clipUrl && mode === "video" && !recording ? "hidden" : ""}`}
          />
          {clipUrl && mode === "video" && !recording && (
            <video src={clipUrl} muted playsInline controls className="size-full object-cover" />
          )}
          {recording && (
            <span className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-background/80 px-2.5 py-1 text-xs font-medium tracking-wide text-foreground uppercase">
              <span className="size-2 rounded-full bg-destructive" />
              Rec {timer}
            </span>
          )}
          {!ready && !error && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              Opening camera…
            </p>
          )}
          {error && (
            <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm leading-relaxed text-foreground">
              {error}
            </p>
          )}
        </div>
        {mode === "stills" && snaps.length > 0 && (
          <ul className="flex gap-2 overflow-x-auto px-4 pt-3">
            {snaps.map((src) => (
              <li key={src} className="size-14 shrink-0 overflow-hidden rounded-md bg-secondary">
                <img src={src} alt="" className="plain-image size-full object-cover" />
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-3 p-4">
          <p className="text-xs text-muted-foreground">
            {mode === "stills"
              ? `${snaps.length} still${snaps.length === 1 ? "" : "s"} · ${Math.max(0, remaining - snaps.length)} left`
              : recording
                ? `Up to ${MAX_RECORD_S}s walkthrough`
                : clipUrl
                  ? "Clip ready to use"
                  : `Record up to ${MAX_RECORD_S} seconds`}
          </p>
          <div className="flex gap-2">
            {mode === "stills" ? (
              <Button type="button" variant="paper" onClick={snap} disabled={!ready || snaps.length >= remaining}>
                <Camera className="size-4" />
                Snap
              </Button>
            ) : recording ? (
              <Button type="button" variant="paper" onClick={stopRecording}>
                <Square className="size-3.5 fill-current" />
                Stop
              </Button>
            ) : (
              <Button type="button" variant="paper" onClick={startRecording} disabled={!ready}>
                <Video className="size-4" />
                {clipUrl ? "Re-record" : "Record"}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const hasPayload = mode === "stills" ? snaps.length > 0 : Boolean(clipUrl);
                if (hasPayload) finish();
                else onClose();
              }}
              disabled={recording}
            >
              {mode === "stills"
                ? snaps.length > 0
                  ? "Use stills"
                  : "Cancel"
                : clipUrl
                  ? "Use clip"
                  : "Cancel"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
