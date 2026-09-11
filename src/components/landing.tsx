import { ArrowRight, DraftingCompass } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { analyzeFloorPlan } from "@/lib/floorplan/analyze";
import { relativeTime } from "@/lib/floorplan/format";
import { attachSite, buildSiteHint } from "@/lib/floorplan/geo";
import { prepareForAnalysis, filesToMedia, type MediaItem } from "@/lib/floorplan/media";
import { SAMPLE_PLAN } from "@/lib/floorplan/sample";
import { loadSampleSurvey, SAMPLE_SURVEY_FILES, SAMPLE_SURVEY_HINT } from "@/lib/floorplan/sample-survey";
import { usePlanStore } from "@/lib/floorplan/store";
import type { SurveySite, Units } from "@/lib/floorplan/types";
import { DropZone, type DropZoneHandle } from "./drop-zone";
import { FloorlineMark } from "./mark";
import { MiniPlan } from "./plan-canvas";
import { Button } from "./ui/button";
import { CommandMenu } from "./command-menu";

export function Landing() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [hint, setHint] = useState("");
  const siteRef = useRef<SurveySite | null>(null);
  const dropRef = useRef<DropZoneHandle>(null);
  const unitsPref = usePlanStore((s) => s.unitsPref);
  const setUnitsPref = usePlanStore((s) => s.setUnitsPref);
  const openSample = usePlanStore((s) => s.openSample);
  const setPlan = usePlanStore((s) => s.setPlan);
  const setStatus = usePlanStore((s) => s.setStatus);
  const setError = usePlanStore((s) => s.setError);
  const setSurveyFrames = usePlanStore((s) => s.setSurveyFrames);
  const beginWork = usePlanStore((s) => s.beginWork);
  const isCurrentWork = usePlanStore((s) => s.isCurrentWork);
  const status = usePlanStore((s) => s.status);
  const error = usePlanStore((s) => s.error);
  const saved = usePlanStore((s) => s.saved);
  const hydrated = usePlanStore((s) => s.hydrated);
  const loadSaved = usePlanStore((s) => s.loadSaved);
  const plan = usePlanStore((s) => s.plan);
  const setView = usePlanStore((s) => s.setView);
  const busy = status === "preparing" || status === "analyzing";

  const sample = useMemo(() => SAMPLE_PLAN, []);

  const generate = async (media: MediaItem[], extraHint?: string, site?: SurveySite, existingWorkId?: number) => {
    if (media.length === 0) return;
    const usedSite = site ?? siteRef.current;
    const siteHint = usedSite ? buildSiteHint(usedSite) : "";
    const workId = existingWorkId ?? beginWork("preparing", "Reading frames");
    setSurveyFrames([]);
    try {
      const prepared = await prepareForAnalysis(media);
      if (!isCurrentWork(workId)) return;
      setSurveyFrames(prepared.images.map((image) => image.previewUrl));
      setStatus("analyzing", "Sketching the diagram");
      const result = await Promise.race([
        analyzeFloorPlan({
          data: {
            images: prepared.images.map((image) => ({ mime: image.mime, data: image.data })),
            hint: extraHint?.trim() || siteHint || hint.trim() || undefined,
            units: unitsPref,
            sourceKind: prepared.sourceKind,
          },
        }),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error("timeout")), 45000);
        }),
      ]);
      if (!isCurrentWork(workId)) {
        for (const image of prepared.images) URL.revokeObjectURL(image.previewUrl);
        return;
      }
      if (!result.ok) {
        setError(result.error);
        setStatus("error");
        setSurveyFrames([]);
        for (const image of prepared.images) URL.revokeObjectURL(image.previewUrl);
        return;
      }
      if (!isCurrentWork(workId)) {
        for (const image of prepared.images) URL.revokeObjectURL(image.previewUrl);
        return;
      }
      const titled =
        usedSite?.fix?.address && /untitled/i.test(result.plan.title)
          ? { ...result.plan, title: usedSite.fix.address.split(",")[0] ?? result.plan.title }
          : result.plan;
      setPlan(
        attachSite(
          {
            ...titled,
            sourceKind: prepared.sourceKind,
            sourceCount: prepared.sourceCount,
          },
          usedSite ?? { fix: null, headings: [], track: [] },
        ),
      );
      window.setTimeout(() => {
        for (const image of prepared.images) URL.revokeObjectURL(image.previewUrl);
      }, 400);
    } catch (err) {
      if (!isCurrentWork(workId)) return;
      const message =
        err instanceof Error && err.message === "timeout"
          ? "That took too long. Try the sample loft, or send fewer photos."
          : err instanceof Error
            ? err.message
            : "Could not trace a plan from those frames.";
      setError(message);
      setStatus("error");
      setSurveyFrames([]);
    }
  };

  const applyGuided = async (files: File[], walkHint: string, site: SurveySite) => {
    for (const item of items) URL.revokeObjectURL(item.previewUrl);
    const media = filesToMedia(files);
    setItems(media);
    setHint(walkHint);
    siteRef.current = site;
    await generate(media, walkHint, site);
  };

  const applyGuidedPreview = async (walkHint: string, site: SurveySite) => {
    if (busy) return;
    const workId = beginWork("preparing", "Loading sample frames");
    try {
      for (const item of items) URL.revokeObjectURL(item.previewUrl);
      const media = await loadSampleSurvey();
      if (!isCurrentWork(workId)) return;
      setItems(media);
      setHint(walkHint);
      siteRef.current = site;
      await generate(media, walkHint, site, workId);
    } catch (err) {
      if (!isCurrentWork(workId)) return;
      const message = err instanceof Error ? err.message : "Could not load the sample survey.";
      setError(message);
      setStatus("error");
    }
  };

  const traceSample = async () => {
    if (busy) return;
    const workId = beginWork("preparing", "Loading sample frames");
    try {
      for (const item of items) URL.revokeObjectURL(item.previewUrl);
      const media = await loadSampleSurvey();
      if (!isCurrentWork(workId)) return;
      setItems(media);
      await generate(media, SAMPLE_SURVEY_HINT, undefined, workId);
    } catch (err) {
      if (!isCurrentWork(workId)) return;
      const message = err instanceof Error ? err.message : "Could not load the sample survey.";
      setError(message);
      setStatus("error");
    }
  };

  const unitsToggle = (
    <div className="flex rounded-lg bg-secondary p-1">
      {(["ft", "m"] as Units[]).map((unit) => (
        <button
          key={unit}
          type="button"
          onClick={() => setUnitsPref(unit)}
          className={`h-11 min-w-16 rounded-md px-3 text-sm units-btn ${
            unitsPref === unit ? "bg-background text-foreground" : "text-muted-foreground"
          }`}
        >
          {unit === "ft" ? "Feet" : "Metres"}
        </button>
      ))}
    </div>
  );

  return (
    <div className="relative min-h-dvh overflow-y-auto bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 z-0 drafting-grid opacity-40" />
      <header className="landing-header relative z-20 px-page">
        <CommandMenu
          surface="home"
          onPhotos={() => dropRef.current?.openPhotos()}
          onCamera={() => dropRef.current?.openCamera()}
          onWalk={() => dropRef.current?.openWalk()}
          onSample={openSample}
          onTrace={traceSample}
          onDraft={() => generate(items)}
          canDraft={items.length > 0}
        />
        <FloorlineMark />
      </header>

      <main className={`landing-main relative z-10 px-page ${items.length > 0 ? "has-draft" : ""}`}>
        <section className="stagger-enter">
          <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">Survey from frames</p>
          <h1 className="landing-title font-display text-foreground">
            Turn a walkthrough into a measured plan.
          </h1>
          <p className="landing-copy max-w-md text-base leading-relaxed text-pretty text-muted-foreground">
            Follow live prompts as you film each room, photograph a space, or drop a clip. Floorline traces walls, doors,
            windows, and furniture onto a sheet you can restyle and export.
          </p>

          {hydrated && plan && (
            <Button
              type="button"
              variant="outline"
              className="resume-chip mt-5 h-12 w-full max-w-md tap-target"
              onClick={() => setView("studio")}
            >
              Resume {plan.title}
              <ArrowRight className="size-4" />
            </Button>
          )}

          <div className="landing-commands mt-5 flex flex-col gap-3">
            <Button
              type="button"
              variant="paper"
              className="h-12 w-full tap-target"
              onClick={openSample}
              disabled={busy}
            >
              Open sample loft
              <ArrowRight className="size-4" />
            </Button>
            <div className="landing-drop">
              <DropZone
                ref={dropRef}
                items={items}
                onChange={setItems}
                disabled={busy}
                onGuidedComplete={applyGuided}
                onGuidedPreview={applyGuidedPreview}
              />
            </div>
          </div>

          {items.length > 0 && (
            <div className="mt-4 flex flex-col gap-3">
              <label className="block">
                <span className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
                  Optional notes
                </span>
                <textarea
                  value={hint}
                  onChange={(event) => setHint(event.target.value)}
                  maxLength={600}
                  rows={2}
                  placeholder="Two-bed, kitchen on the south wall, units in feet…"
                  className="mt-2 w-full resize-none rounded-xl border border-border bg-card px-3 py-2.5 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/70"
                />
              </label>
              <div className="draft-inline flex-wrap items-center gap-3">
                {unitsToggle}
                <Button type="button" variant="paper" onClick={() => generate(items)} disabled={busy} className="min-w-40">
                  {busy ? "Tracing…" : "Draft plan"}
                  {!busy && <ArrowRight className="size-4" />}
                </Button>
              </div>
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-xl border border-border bg-card px-4 py-3 text-sm leading-relaxed text-pretty text-foreground">
              {error}
            </p>
          )}

          {hydrated && saved.length > 0 && (
            <div className="mt-8">
              <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">On this device</p>
              <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
                {saved.slice(0, 4).map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => loadSaved(entry.id)}
                      className="flex h-14 w-full items-center justify-between px-4 text-left"
                    >
                      <span className="text-sm text-foreground">{entry.title}</span>
                      <span className="text-xs text-muted-foreground">{relativeTime(entry.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="landing-aside stagger-enter stagger-delay">
          <button
            type="button"
            onClick={openSample}
            disabled={busy}
            className="sample-card group flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-card text-left shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-foreground)_4%,transparent)] transition-[transform,box-shadow] duration-200 hover:shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-foreground)_8%,transparent)] active:scale-[0.99] disabled:opacity-60"
          >
            <div className="sample-preview bg-paper">
              <MiniPlan plan={sample} />
            </div>
            <div className="sample-body">
              <div>
                <p className="flex items-center gap-2 text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
                  <DraftingCompass className="size-3.5" />
                  Sample loft
                </p>
                <p className="sample-heading font-display text-foreground">Open a finished sheet</p>
                <p className="mt-1 text-sm text-muted-foreground">30' × 28' · six rooms · furniture in place</p>
              </div>
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
                <ArrowRight className="size-4" />
              </span>
            </div>
          </button>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="survey-thumbs">
              {SAMPLE_SURVEY_FILES.map((entry) => (
                <img
                  key={entry.src}
                  src={entry.src}
                  alt={entry.label}
                  className="plain-image block w-full object-cover"
                />
              ))}
            </div>
            <div className="survey-footer">
              <div>
                <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Sample survey</p>
                <p className="sample-heading font-display text-foreground">Trace these rooms</p>
                <p className="mt-1 text-sm text-muted-foreground">Four stills of a compact loft</p>
              </div>
              <Button type="button" variant="paper" onClick={traceSample} disabled={busy} className="survey-action h-11">
                Trace
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>

          <p className="px-1 pb-2 text-xs leading-relaxed text-muted-foreground">
            Photograph corners and doorways, or film a slow walkthrough. Floorline infers scale from typical door and
            room sizes when a tape is not in frame.
          </p>
        </section>
      </main>

      {items.length > 0 && (
        <div className="draft-bar pointer-events-auto fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-page pt-3 pb-safe-lg">
          <div className="flex items-center gap-2">
            {unitsToggle}
            <Button type="button" variant="paper" onClick={() => generate(items)} disabled={busy} className="h-12 flex-1">
              {busy ? "Tracing…" : "Draft plan"}
              {!busy && <ArrowRight className="size-4" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
