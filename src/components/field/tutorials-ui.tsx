import { CircleHelp, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  TUTORIAL_CATEGORIES,
  resetWelcome,
  tutorialsFor,
  type Tutorial,
  type TutorialApp,
} from "@/lib/field/tutorials";

export function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Help and tutorials"
      title="Help"
      data-testid="help-button"
      onClick={onClick}
      className="flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-black/5"
    >
      <CircleHelp />
    </button>
  );
}

/** Small "?" that opens one topic. Sketch state stays put. */
export function HelpMark({ id, label = "How this works" }: { id: string; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={`help-${id}`}
      onClick={(e) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent("floorline-help", { detail: id }));
      }}
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-black/5 text-base font-bold text-[#8a3b12]"
    >
      ?
    </button>
  );
}

export function WelcomeTip({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  return (
    <div
      className="absolute inset-x-3 bottom-24 z-30 rounded-2xl bg-[#1c1b18] p-4 text-white shadow-xl"
      role="dialog"
      aria-label="Getting started tour"
      data-testid="welcome-tip"
    >
      <p className="text-lg font-bold">Quick tour?</p>
      <p className="mt-1 text-sm text-white/75">
        A minute on the sketch screen — add a room, the laser, and export. Your drawing stays where it is.
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onStart} className="h-12 flex-1 rounded-xl bg-[#b4561d] text-base font-bold">
          Show me
        </button>
        <button type="button" onClick={onDismiss} className="h-12 flex-1 rounded-xl bg-white/10 text-base font-semibold">
          Not now
        </button>
      </div>
    </div>
  );
}

export function TutorialHost({
  app,
  topic,
  onClose,
}: {
  app: TutorialApp;
  /** null shows the list. A topic id opens that how-to. */
  topic: string | null;
  onClose: () => void;
}) {
  const all = useMemo(() => tutorialsFor(app), [app]);
  const [query, setQuery] = useState("");
  const [id, setId] = useState<string | null>(topic);
  useEffect(() => setId(topic), [topic]);
  const current = all.find((t) => t.id === id) ?? null;
  const q = query.trim().toLowerCase();
  const shown = q
    ? all.filter((t) =>
        `${t.title} ${t.blurb} ${t.category} ${t.steps.map((s) => `${s.title} ${s.body}`).join(" ")}`
          .toLowerCase()
          .includes(q),
      )
    : all;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#f6f2e8]" role="dialog" aria-label="Tutorials">
      <header
        className="flex items-center gap-2 border-b border-black/10 bg-white px-2 py-2"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      >
        {current ? (
          <button type="button" onClick={() => setId(null)} className="h-12 rounded-full px-3 text-base font-semibold">
            All topics
          </button>
        ) : (
          <h2 className="px-2 text-xl font-bold">How to</h2>
        )}
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Close help"
          onClick={onClose}
          className="flex size-12 items-center justify-center rounded-full bg-black/5"
        >
          <X />
        </button>
      </header>
      {current ? (
        <TutorialDetail tutorial={current} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <label className="mb-4 flex h-12 items-center gap-2 rounded-xl border border-black/15 bg-white px-3">
            <Search className="size-5 text-black/40" />
            <input
              aria-label="Search tutorials"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search — laser, closet, PDF…"
              className="h-full min-w-0 flex-1 bg-transparent text-base outline-none"
            />
          </label>
          {shown.length === 0 && <p className="text-base text-black/50">Nothing matches “{query}”.</p>}
          {TUTORIAL_CATEGORIES.map((category) => {
            const items = shown.filter((t) => t.category === category);
            if (items.length === 0) return null;
            return (
              <section key={category} className="mb-5">
                <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-black/45">{category}</h3>
                <div className="space-y-2">
                  {items.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setId(t.id)}
                      className="flex w-full flex-col rounded-2xl bg-white px-4 py-3 text-left shadow-sm"
                    >
                      <span className="text-lg font-bold">{t.title}</span>
                      <span className="text-sm text-black/55">{t.blurb}</span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
          <button
            type="button"
            onClick={() => {
              resetWelcome();
              onClose();
              window.dispatchEvent(new CustomEvent("floorline-welcome"));
            }}
            className="mb-6 text-sm font-semibold text-[#8a3b12] underline"
          >
            Show the welcome tip again
          </button>
        </div>
      )}
    </div>
  );
}

function TutorialDetail({ tutorial }: { tutorial: Tutorial }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <h2 className="text-2xl font-bold">{tutorial.title}</h2>
      <p className="mt-1 text-base text-black/60">{tutorial.blurb}</p>
      {tutorial.video && (
        <figure className="mt-4">
          <video
            src={tutorial.video}
            muted
            loop
            autoPlay
            playsInline
            controls
            className="w-full rounded-2xl bg-black"
          />
          {tutorial.videoKind === "placeholder" && (
            <figcaption className="mt-1 text-xs text-black/45">
              Placeholder clip. Replace <span className="font-mono">{tutorial.video.replace(/^\//, "public/")}</span> with
              your own MP4.
            </figcaption>
          )}
        </figure>
      )}
      <ol className="mt-4 space-y-4 pb-10">
        {tutorial.steps.map((s, i) => (
          <li key={s.image} className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <img src={s.image} alt="" className="aspect-[4/3] w-full object-cover bg-[#efe2c6]" />
            <div className="space-y-1 p-4">
              <div className="text-sm font-bold text-[#8a3b12]">
                {i + 1}. {s.title}
              </div>
              <p className="text-base">{s.body}</p>
              {s.imageKind === "placeholder" && (
                <p className="text-xs text-black/40">
                  Placeholder picture. Replace <span className="font-mono">{s.image.replace(/^\//, "public/")}</span>.
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
