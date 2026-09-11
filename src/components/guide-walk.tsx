import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Pause, Play, Square, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { coachWalkFrame, type CoachAdvice } from "@/lib/floorplan/coach";
import {
  appendTrackPoint,
  buildSiteHint,
  cardinalLabel,
  formatAccuracy,
  mergeHeading,
  siteFromFix,
  startCompass,
  startGps,
} from "@/lib/floorplan/geo";
import {
  buildGuideCues,
  buildGuideHint,
  HOLD_LOCK_MS,
  localCoach,
  MAX_GUIDED_RECORD_S,
  sampleIndexForCue,
  TYPICAL_SPACE_IDS,
} from "@/lib/floorplan/guide";
import {
  COACH_GAP_MS,
  cueDirection,
  emptyMetrics,
  encodeFrame,
  MAX_COACH_CALLS,
  metricsFromFrames,
  type LiveMetrics,
} from "@/lib/floorplan/live-scan";
import { SAMPLE_SURVEY_FILES } from "@/lib/floorplan/sample-survey";
import { reverseSite } from "@/lib/floorplan/site";
import type { HeadingSample, SiteFix, SurveySite } from "@/lib/floorplan/types";
import { Button } from "./ui/button";

type Phase = "live" | "handoff";

type Props = {
  onClose: () => void;
  onComplete: (files: File[], hint: string, site: SurveySite) => void;
  onPreviewComplete: (hint: string, site: SurveySite) => void;
};

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  return types.find((type) => MediaRecorder.isTypeSupported(type));
}

const ARROWS = {
  left: ArrowLeft,
  right: ArrowRight,
  up: ArrowUp,
  down: ArrowDown,
} as const;

export function GuideWalk({ onClose, onComplete, onPreviewComplete }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stillsRef = useRef<File[]>([]);
  const videoFileRef = useRef<File | null>(null);
  const clipRef = useRef<string | null>(null);
  const snapsRef = useRef<string[]>([]);
  const liveRef = useRef(true);
  const cueIndexRef = useRef(0);
  const metricsRef = useRef<LiveMetrics>(emptyMetrics());
  const adviceRef = useRef<CoachAdvice | null>(null);
  const cueStartedAt = useRef(0);
  const coachBusy = useRef(false);
  const coachCount = useRef(0);
  const lastCoachAt = useRef(0);
  const seenAcc = useRef<string[]>([]);
  const locking = useRef(false);
  const stopRef = useRef<() => void>(() => {});
  const finishRef = useRef<() => void>(() => {});
  const finished = useRef(false);

  const [phase, setPhase] = useState<Phase>("live");
  const spaces = TYPICAL_SPACE_IDS;
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [cueIndex, setCueIndex] = useState(0);
  const [captured, setCaptured] = useState<string[]>([]);
  const [snaps, setSnaps] = useState<string[]>([]);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [previewFrame, setPreviewFrame] = useState(0);
  const [metrics, setMetrics] = useState<LiveMetrics>(emptyMetrics);
  const [advice, setAdvice] = useState<CoachAdvice | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [gpsChip, setGpsChip] = useState("");
  const [holdProgress, setHoldProgress] = useState(0);
  const [displayText, setDisplayText] = useState("");
  const headingsRef = useRef<HeadingSample[]>([]);
  const trackRef = useRef<{ lat: number; lng: number }[]>([]);
  const fixRef = useRef<SiteFix | null>(null);
  const headingRef = useRef<number | null>(null);
  const geocodedRef = useRef(false);
  headingRef.current = heading;

  snapsRef.current = snaps;
  clipRef.current = clipUrl;
  cueIndexRef.current = cueIndex;
  metricsRef.current = metrics;
  adviceRef.current = advice;

  const cues = useMemo(() => buildGuideCues(spaces), [spaces]);
  const cue = cues[Math.min(cueIndex, cues.length - 1)];
  const allCaptured = captured.length >= cues.length;
  const sampleLabel = preview ? SAMPLE_SURVEY_FILES[previewFrame]?.label : undefined;
  const liveText = metrics.tooFast || metrics.dark || metrics.tiltDown ? metrics.prompt : advice?.instruction || cue?.body || "";
  const direction = !paused && recording ? cueDirection(displayText || liveText) : null;
  const Arrow = direction && direction !== "hold" ? ARROWS[direction] : null;
  const active = recording && !paused;

  useEffect(() => {
    if (phase !== "live") {
      setGpsChip("");
      return;
    }
    let cancelled = false;
    setGpsChip("Finding you…");
    const fail = window.setTimeout(() => {
      if (!fixRef.current) setGpsChip("");
    }, 8000);
    const stopGps = startGps((coords) => {
      if (cancelled) return;
      const next = siteFromFix(coords, headingRef.current, fixRef.current?.address ?? null);
      fixRef.current = next;
      trackRef.current = appendTrackPoint(trackRef.current, coords);
      setGpsChip(coords.accuracy < 80 ? formatAccuracy(coords.accuracy) : "");
      if (!geocodedRef.current && coords.accuracy < 80) {
        geocodedRef.current = true;
        void reverseSite({ data: { lat: coords.lat, lng: coords.lng } }).then((result) => {
          if (cancelled || !result.address || !fixRef.current) return;
          fixRef.current = { ...fixRef.current, address: result.address };
        });
      }
    });
    let stopCompass = () => {};
    void startCompass((deg) => {
      if (cancelled) return;
      setHeading(deg);
      if (fixRef.current) fixRef.current = { ...fixRef.current, heading: deg };
    }).then((stop) => {
      stopCompass = stop;
    });
    return () => {
      cancelled = true;
      window.clearTimeout(fail);
      stopGps();
      stopCompass();
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "live") return;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("no-camera");
        }
        const stream = await Promise.race([
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1440 } },
            audio: false,
          }),
          new Promise<never>((_, reject) => {
            window.setTimeout(() => reject(new Error("camera-timeout")), 800);
          }),
        ]);
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
          setPreview(true);
          setReady(true);
          setError("No camera here — we’ll walk through a sample home instead.");
        }
      }
    })();
    return () => {
      cancelled = true;
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [phase]);

  useEffect(() => {
    return () => {
      liveRef.current = false;
      for (const url of snapsRef.current) URL.revokeObjectURL(url);
      if (clipRef.current) URL.revokeObjectURL(clipRef.current);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => {
      setElapsed((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [active]);

  useEffect(() => {
    if (active && elapsed >= MAX_GUIDED_RECORD_S) stopRef.current();
  }, [active, elapsed]);

  useEffect(() => {
    if (!preview || !cue) return;
    setPreviewFrame(sampleIndexForCue(cue));
  }, [preview, cue?.id]);

  useEffect(() => {
    if (phase !== "live" || !ready) return;
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 64;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    let prev: ImageData | null = null;
    let last = 0;
    let raf = 0;
    const tick = (time: number) => {
      raf = requestAnimationFrame(tick);
      if (time - last < 140) return;
      last = time;
      const source = preview ? imgRef.current : videoRef.current;
      if (!source) return;
      const readyW = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
      if (!readyW) return;
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      const curr = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const next = metricsFromFrames(prev, curr);
      prev = curr;
      setMetrics((current) => {
        if (
          current.status === next.status &&
          current.stable === next.stable &&
          current.tooFast === next.tooFast &&
          Math.abs(current.motion - next.motion) < 0.04
        ) {
          return current;
        }
        return next;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, ready, preview]);

  useEffect(() => {
    cueStartedAt.current = Date.now();
    locking.current = false;
    setHoldProgress(0);
    if (cue) {
      setAdvice(localCoach({ cue, metrics: metricsRef.current, sampleLabel }));
    }
  }, [cue?.id, sampleLabel]);

  useEffect(() => {
    const urgent = metrics.tooFast || metrics.dark || metrics.tiltDown;
    const next = urgent ? metrics.prompt : advice?.instruction || cue?.body || "";
    if (urgent) {
      setDisplayText(next);
      return;
    }
    const timer = window.setTimeout(() => setDisplayText(next), 140);
    return () => window.clearTimeout(timer);
  }, [metrics.status, metrics.prompt, advice?.instruction, cue?.body]);

  useEffect(() => {
    if (phase !== "live" || !ready || !cue || paused) return;
    let cancelled = false;
    const run = async () => {
      const local = localCoach({ cue, metrics: metricsRef.current, sampleLabel });
      if (!cancelled) setAdvice(local);
      if (coachBusy.current) return;
      if (coachCount.current >= MAX_COACH_CALLS) return;
      if (Date.now() - lastCoachAt.current < COACH_GAP_MS) return;
      const source = preview ? imgRef.current : videoRef.current;
      if (!source) return;
      coachBusy.current = true;
      try {
        const frame = await encodeFrame(source);
        if (!frame || cancelled || !liveRef.current) return;
        lastCoachAt.current = Date.now();
        coachCount.current += 1;
        const result = await Promise.race([
          coachWalkFrame({
            data: {
              image: frame,
              cueTitle: cue.title,
              cueBody: cue.body,
              needs: cue.needs,
              spaces,
            },
          }),
          new Promise<{ ok: false }>((resolve) => {
            window.setTimeout(() => resolve({ ok: false }), 8000);
          }),
        ]);
        if (cancelled || !result.ok) return;
        seenAcc.current = [...seenAcc.current, ...result.advice.seen];
        setAdvice(result.advice);
      } finally {
        coachBusy.current = false;
      }
    };
    const delay = metrics.stable || preview ? 280 : 900;
    const timer = window.setTimeout(() => {
      void run();
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [phase, ready, cue?.id, previewFrame, sampleLabel, paused]);

  const grabStill = async () => {
    if (preview) return;
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    if (stillsRef.current.length >= 4) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    if (!blob) return;
    const file = new File([blob], `guide-${Date.now()}.jpg`, { type: "image/jpeg" });
    stillsRef.current = [...stillsRef.current, file];
    setSnaps((current) => [...current, URL.createObjectURL(blob)]);
  };

  const markCaptured = () => {
    if (locking.current) return;
    const current = cues[cueIndexRef.current];
    if (!current) return;
    locking.current = true;
    if (headingRef.current != null) {
      headingsRef.current = mergeHeading(headingsRef.current, {
        at: Date.now(),
        heading: headingRef.current,
        label: current.title,
        spaceId: current.spaceId,
      });
    }
    setCaptured((ids) => (ids.includes(current.id) ? ids : [...ids, current.id]));
    void grabStill();
    if (cueIndexRef.current < cues.length - 1) {
      setCueIndex((value) => value + 1);
      setHoldProgress(0);
    } else {
      window.setTimeout(() => stopRef.current(), 650);
    }
  };

  useEffect(() => {
    if (!active || allCaptured || !cue) return;
    let acc = 0;
    const tick = window.setInterval(() => {
      const m = metricsRef.current;
      const a = adviceRef.current;
      const held = Date.now() - cueStartedAt.current;
      const fallback = held > Math.max(9000, cue.holdSeconds * 1800);
      const good = preview || fallback || (Boolean(a?.pass) && !m.tooFast && !m.dark && m.stable);
      if (!good) {
        acc = Math.max(0, acc - 140);
        setHoldProgress(acc / HOLD_LOCK_MS);
        return;
      }
      acc += 100;
      const next = Math.min(1, acc / HOLD_LOCK_MS);
      setHoldProgress(next);
      if (next >= 1) markCaptured();
    }, 100);
    return () => window.clearInterval(tick);
  }, [active, cue?.id, allCaptured, preview]);

  const startRecording = () => {
    if (recording) return;
    seenAcc.current = [];
    coachCount.current = 0;
    lastCoachAt.current = 0;
    headingsRef.current = [];
    setPaused(false);
    if (preview) {
      setElapsed(0);
      setCueIndex(0);
      setCaptured([]);
      setHoldProgress(0);
      setRecording(true);
      return;
    }
    const stream = streamRef.current;
    const mime = pickRecorderMime();
    if (!stream || !mime || typeof MediaRecorder === "undefined") {
      setError("Video recording isn’t available here — we’ll walk through a sample home instead.");
      setPreview(true);
      setElapsed(0);
      setCueIndex(0);
      setCaptured([]);
      setHoldProgress(0);
      setRecording(true);
      return;
    }
    if (clipUrl) {
      URL.revokeObjectURL(clipUrl);
      setClipUrl(null);
    }
    chunksRef.current = [];
    stillsRef.current = [];
    for (const url of snaps) URL.revokeObjectURL(url);
    setSnaps([]);
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      if (!liveRef.current) return;
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      const file = new File([blob], `guided-walk-${Date.now()}.${ext}`, { type: blob.type });
      videoFileRef.current = file;
      setClipUrl(URL.createObjectURL(blob));
      recorderRef.current = null;
      setPhase("handoff");
      window.setTimeout(() => finishRef.current(), 280);
    };
    recorder.start(250);
    recorderRef.current = recorder;
    setElapsed(0);
    setCueIndex(0);
    setCaptured([]);
    setHoldProgress(0);
    setRecording(true);
  };

  const pauseRecording = () => {
    if (!recording || paused) return;
    const recorder = recorderRef.current;
    try {
      if (recorder?.state === "recording") recorder.pause();
    } catch {
      /* pause is optional on some browsers */
    }
    setPaused(true);
  };

  const resumeRecording = () => {
    if (!recording || !paused) return;
    const recorder = recorderRef.current;
    try {
      if (recorder?.state === "paused") recorder.resume();
    } catch {
      /* resume is optional on some browsers */
    }
    setPaused(false);
  };

  const stopRecording = () => {
    setPaused(false);
    setRecording(false);
    setHoldProgress(0);
    if (preview) {
      setPhase("handoff");
      window.setTimeout(() => finishRef.current(), 280);
      return;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else {
      setPhase("handoff");
      window.setTimeout(() => finishRef.current(), 280);
    }
  };
  stopRef.current = stopRecording;

  const collectSite = (): SurveySite => ({
    fix: fixRef.current,
    headings: headingsRef.current,
    track: trackRef.current,
  });

  const hint = buildGuideHint(
    spaces,
    captured
      .map((id) => cues.find((entry) => entry.id === id)?.title)
      .filter((title): title is string => Boolean(title)),
    seenAcc.current,
  );

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    const site = collectSite();
    const siteHint = buildSiteHint(site);
    const fullHint = [hint, siteHint].filter(Boolean).join(" ").slice(0, 600);
    if (preview || !videoFileRef.current) {
      onPreviewComplete(fullHint, site);
      return;
    }
    onComplete([videoFileRef.current, ...stillsRef.current], fullHint, site);
  };
  finishRef.current = finish;

  const timer = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const previewSrc = SAMPLE_SURVEY_FILES[previewFrame]?.src;
  const nextCue = cues[cueIndex + 1];
  const statusLabel = paused
    ? "Paused"
    : metrics.status === "slow"
      ? "Slow down"
      : metrics.status === "dark"
        ? "A bit dark"
        : metrics.status === "tilt"
          ? "Tip down"
          : holdProgress > 0.2
            ? "Hold still"
            : recording
              ? timer
              : "Ready";
  const cueCopy = !recording
    ? "Line up this space, then tap Start."
    : paused
      ? "Paused. Resume when the frame looks right."
      : displayText || cue?.body || "";
  const phaseLabel = phase === "handoff" ? "Drawing" : paused ? "Paused" : recording ? "Walk" : "Ready";
  const phaseTitle = phase === "handoff" ? "Putting the sheet together" : cue?.title || "Guided walk";

  const overlay = (
    <div className="guide-overlay">
      <header className="guide-top">
        <Button type="button" size="icon" variant="secondary" className="tap-target relative z-20 size-11" onClick={onClose} aria-label="Close walk">
          <X className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">{phaseLabel}</p>
          <p className="truncate text-sm text-foreground">{phaseTitle}</p>
        </div>
        {phase === "live" && (
          <span className={`guide-rec ${holdProgress > 0.55 ? "is-pass" : ""} ${metrics.tooFast ? "is-warn" : ""} ${paused ? "is-paused" : ""}`}>
            {active && <span className="guide-rec-dot" />}
            {statusLabel}
          </span>
        )}
      </header>

      {error && phase === "live" && <p className="guide-film-note">{error}</p>}

      {phase === "live" && (
        <div className="guide-stage">
          <div className="guide-view">
            <video ref={videoRef} muted playsInline className={`guide-video ${preview ? "is-off" : ""}`} />
            {preview && previewSrc && (
              <img ref={imgRef} src={previewSrc} alt="" className="plain-image guide-video object-cover" />
            )}
            <div className="guide-brackets" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            {Arrow && (
              <span className="guide-arrow" aria-hidden="true">
                <Arrow className="size-6" />
              </span>
            )}
            {!ready && (
              <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Opening camera…</p>
            )}
            {paused && (
              <p className="guide-paused-chip" role="status">
                Paused
              </p>
            )}
            {heading != null && (
              <div className="guide-geo">
                <div className="guide-compass">
                  <div className="guide-compass-rose" style={{ transform: `rotate(${-heading}deg)` }}>
                    <span className="guide-compass-n">N</span>
                  </div>
                  <span className="guide-compass-lubber" />
                </div>
                <p className="guide-geo-read">
                  {Math.round(heading)}° {cardinalLabel(heading)}
                  {gpsChip ? <span>{gpsChip}</span> : null}
                </p>
              </div>
            )}
            <ol className="guide-progress" aria-label="Walk progress">
              {cues.map((item, index) => (
                <li
                  key={item.id}
                  className={captured.includes(item.id) ? "is-done" : index === cueIndex ? "is-now" : ""}
                />
              ))}
            </ol>
            {cue && (
              <div key={cue.id} className={`guide-cue ${holdProgress > 0.55 ? "is-pass" : ""}`} role="status" aria-live="polite">
                <p className="guide-cue-kicker">
                  {Math.min(cueIndex + 1, cues.length)} of {cues.length}
                  {nextCue ? ` · next ${nextCue.title}` : " · last stop"}
                </p>
                <p className="guide-cue-body">{cueCopy}</p>
                {active && (
                  <span className="guide-hold" aria-hidden="true">
                    <span style={{ transform: `scaleX(${holdProgress})` }} />
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="guide-actions" role="group" aria-label="Walk controls">
            <Button
              type="button"
              variant="paper"
              className="tap-target"
              disabled={!ready || recording}
              onClick={startRecording}
            >
              <Play className="size-4" />
              Start
            </Button>
            <Button
              type="button"
              variant={paused ? "paper" : "secondary"}
              className="tap-target"
              disabled={!recording}
              aria-pressed={paused}
              onClick={paused ? resumeRecording : pauseRecording}
            >
              {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
              {paused ? "Resume" : "Pause"}
            </Button>
            <Button type="button" variant="outline" className="tap-target" disabled={!recording} onClick={stopRecording}>
              <Square className="size-4" />
              Stop
            </Button>
          </div>
        </div>
      )}

      {phase === "handoff" && (
        <div className="guide-handoff">
          <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">That’s the walk</p>
          <h2 className="font-display text-3xl leading-tight text-foreground">Drawing the plan…</h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-pretty text-muted-foreground">
            Hang on a moment while we trace the rooms from what we just saw.
          </p>
        </div>
      )}
    </div>
  );

  return createPortal(overlay, document.body);
}
