import { Ruler, X } from "lucide-react";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  HEADINGS,
  addOpening,
  closetRectangle,
  closeDraft,
  commitDraft,
  currentWall,
  draftHistory,
  previewEnd,
  pushDraft,
  shoot,
  shootMeters,
  startClosetChain,
  undoDraft,
  type CommittedOutline,
  type Draft,
  type DraftOpening,
  type ShotResult,
} from "@/lib/field/arrow-draw";
import {
  connectDevice,
  connectLaser,
  disconnectLaser,
  forgetLaser,
  publishMockMeters,
  setDistoMock,
  useDisto,
  type DistoSnapshot,
} from "@/lib/field/disto-link";
import { metersToPlan, planToMeters } from "@/lib/field/disto-protocol";
import { formatLength, parseLength, uid, type Pt, type Units } from "@/lib/field/model";

export type PlanDraft = {
  points: Pt[];
  closets: Pt[][];
  openings: { a: Pt; b: Pt }[];
  /** Closet chain still being walked, not closed yet. */
  openCloset: Pt[] | null;
  preview: Pt | null;
};

const STATUS_LABEL: Record<DistoSnapshot["status"], string> = {
  off: "Not connected",
  scanning: "Looking for DISTO…",
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  disconnected: "Disconnected",
};

function dotClass(status: DistoSnapshot["status"]): string {
  if (status === "connected") return "bg-green-600";
  if (status === "scanning" || status === "connecting" || status === "reconnecting") return "bg-amber-500";
  if (status === "disconnected") return "bg-red-600";
  return "bg-black/25";
}

export function LaserButton({ onClick }: { onClick: () => void }) {
  const disto = useDisto();
  const label =
    disto.status === "connected"
      ? `Laser connected, ${disto.name || "DISTO"}`
      : `Connect laser, ${STATUS_LABEL[disto.status]}`;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="relative flex size-12 shrink-0 items-center justify-center rounded-full hover:bg-black/5"
    >
      <Ruler />
      <span className={`absolute right-1.5 top-1.5 size-2.5 rounded-full ${dotClass(disto.status)}`} />
    </button>
  );
}

export function LaserReadout({
  label,
  detail,
  onReshoot,
}: {
  label: string;
  detail: string | null;
  onReshoot: (() => void) | null;
}) {
  const disto = useDisto();
  if (disto.status === "off" && !detail) return null;
  return (
    <div className="flex items-center gap-3 border-b border-black/10 bg-[#1c1b18] px-3 py-2 text-white">
      <span className={`size-2.5 shrink-0 rounded-full ${dotClass(disto.status)}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-2xl font-bold leading-tight">{label}</div>
        <div className="truncate text-sm text-white/75">
          {detail ||
            (disto.status === "connected"
              ? `${disto.name || "DISTO"} · tap a wall, then press DIST`
              : STATUS_LABEL[disto.status])}
          {disto.error ? ` · ${disto.error}` : ""}
        </div>
      </div>
      {onReshoot && (
        <button
          type="button"
          onClick={onReshoot}
          className="h-11 shrink-0 rounded-full bg-white px-4 text-sm font-bold text-black"
        >
          Re-shoot
        </button>
      )}
    </div>
  );
}

export function LaserSheet({
  units,
  onClose,
  onDraw,
}: {
  units: Units;
  onClose: () => void;
  onDraw: () => void;
}) {
  const disto = useDisto();
  const [mockText, setMockText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="absolute inset-x-0 bottom-0 z-30 max-h-[70%] overflow-y-auto rounded-t-3xl border-t border-black/10 bg-[#fbf7ed] shadow-[0_-8px_24px_rgba(0,0,0,0.15)]">
      <header className="sticky top-0 flex items-center gap-2 border-b border-black/10 bg-white px-3 py-2">
        <span className={`size-3 rounded-full ${dotClass(disto.status)}`} />
        <h2 className="flex-1 text-lg font-bold">Laser</h2>
        <button type="button" aria-label="Close laser" onClick={onClose} className="flex size-12 items-center justify-center rounded-full bg-black/5">
          <X />
        </button>
      </header>
      <div className="space-y-3 p-4">
        <p className="text-base text-black/70">
          {disto.name || "Leica DISTO D2"} · {STATUS_LABEL[disto.status]}
          {disto.last ? ` · last ${formatLength(metersToPlan(disto.last.meters, units), units)}` : ""}
        </p>
        {disto.error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{disto.error}</p>}
        {note && <p className="text-sm text-black/60">{note}</p>}
        <div className="flex gap-2">
          {disto.status === "connected" ? (
            <button type="button" onClick={() => void disconnectLaser()} className="h-12 flex-1 rounded-xl bg-black/5 text-base font-semibold">
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void connectLaser()}
              className="h-12 flex-1 rounded-xl bg-[#b4561d] text-base font-bold text-white"
            >
              {disto.status === "scanning" || disto.status === "connecting" ? "Looking…" : "Connect laser"}
            </button>
          )}
          <button type="button" onClick={onDraw} className="h-12 flex-1 rounded-xl bg-black text-base font-bold text-white">
            Draw walls
          </button>
        </div>
        {disto.status === "connected" && disto.name && !disto.mock && (
          <button type="button" onClick={() => void forgetLaser()} className="text-sm font-semibold text-black/50 underline">
            Forget this DISTO
          </button>
        )}
        {disto.devices.length > 0 && disto.status !== "connected" && (
          <ul className="space-y-2">
            {disto.devices.map((device) => (
              <li key={device.id}>
                <button
                  type="button"
                  onClick={() => void connectDevice(device.id, device.name)}
                  className="flex h-14 w-full items-center justify-between rounded-xl bg-white px-4 text-left text-base font-semibold shadow-sm"
                >
                  <span>{device.name}</span>
                  <span className="text-sm text-black/45">{device.rssi == null ? "" : `${device.rssi} dBm`}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <label className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-base">
          <span>
            Simulate DISTO
            <span className="block text-sm text-black/50">Debug — no laser needed</span>
          </span>
          <input
            type="checkbox"
            className="size-6"
            checked={disto.mock}
            onChange={(e) => setDistoMock(e.target.checked)}
          />
        </label>
        {disto.mock && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = parseLength(mockText, units);
              if (n == null) {
                setNote("Couldn't read that length. Try 12'6\" or 3.2");
                return;
              }
              const err = publishMockMeters(planToMeters(n, units));
              setNote(err);
            }}
          >
            <input
              aria-label="Simulated DISTO reading"
              value={mockText}
              onChange={(e) => setMockText(e.target.value)}
              placeholder={units === "ft" ? `13'11"` : "4.24"}
              className="h-12 min-w-0 flex-1 rounded-xl border border-black/15 bg-white px-3 text-lg"
            />
            <button type="submit" className="h-12 rounded-xl bg-black px-4 text-base font-bold text-white">
              Send
            </button>
          </form>
        )}
        <p className="text-sm text-black/55">
          Tap a wall on the plan, then press DIST. The length fills that wall and the next wall is selected. Or use Draw walls to build a room shot by shot.
        </p>
      </div>
    </div>
  );
}

type Arm = "wall" | "open-width" | "open-offset" | "closet-width" | "closet-depth";

export function ArrowSheet({
  units,
  levelId,
  origin,
  defaultName,
  undoRef,
  readingRef,
  onDraft,
  onCommit,
  onClose,
}: {
  units: Units;
  levelId: string;
  origin: Pt;
  defaultName: string;
  undoRef: MutableRefObject<(() => boolean) | null>;
  readingRef: MutableRefObject<((meters: number) => boolean) | null>;
  onDraft: (draft: PlanDraft | null) => void;
  onCommit: (committed: CommittedOutline) => void;
  onClose: () => void;
}) {
  const disto = useDisto();
  const [hist, setHist] = useState(() => draftHistory(0));
  const [name, setName] = useState(defaultName);
  const [lengthText, setLengthText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [panel, setPanel] = useState<"pad" | "opening" | "closet">("pad");
  const [arm, setArm] = useState<Arm>("wall");
  const [kind, setKind] = useState<DraftOpening["kind"]>("door");
  const [widthText, setWidthText] = useState("");
  const [offsetText, setOffsetText] = useState("");
  const [transition, setTransition] = useState<DraftOpening["transition"]>("auto");
  const [cWidth, setCWidth] = useState("");
  const [cDepth, setCDepth] = useState("");
  const [outward, setOutward] = useState(true);
  const [mockText, setMockText] = useState("");
  const histRef = useRef(hist);
  histRef.current = hist;
  const draft = hist.present;
  const armRef = useRef(arm);
  armRef.current = arm;
  const takeRef = useRef<(result: ShotResult) => void>(() => {});
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;
  const unitsRef = useRef(units);
  unitsRef.current = units;

  const publish = (next: Draft) => {
    onDraft(overlayOf(next));
  };

  const take = (result: ShotResult, committedName = name) => {
    if (!result.ok) {
      setNote(result.reason);
      return;
    }
    if (result.event === "closed" && result.draft.roomClosed && !result.draft.closetChain) {
      const done = commitDraft(result.draft, {
        name: committedName.trim() || "Room",
        levelId,
        units,
        origin,
        ids: (prefix) => uid(prefix),
      });
      if (!done.ok) {
        setNote(done.reason);
        setHist(pushDraft(histRef.current, result.draft));
        publish(result.draft);
        return;
      }
      onCommit(done.committed);
      const fresh = draftHistory(result.draft.headingDeg);
      setHist(fresh);
      publish(fresh.present);
      setNote(`Closed. Gap ${formatLength(result.closingError, units)}.`);
      setPanel("pad");
      setArm("wall");
      return;
    }
    setHist(pushDraft(histRef.current, result.draft));
    publish(result.draft);
    if (result.event === "closed") setNote(`Closet closed. Gap ${formatLength(result.closingError, units)}.`);
    else setNote(null);
  };
  takeRef.current = take;

  useEffect(() => {
    onDraftRef.current(overlayOf(histRef.current.present));
    undoRef.current = () => {
      const h = histRef.current;
      if (h.past.length === 0) return false;
      const next = undoDraft(h);
      setHist(next);
      onDraftRef.current(overlayOf(next.present));
      setNote(null);
      return true;
    };
    readingRef.current = (meters) => {
      const planUnits = unitsRef.current;
      const length = metersToPlan(meters, planUnits);
      const mode = armRef.current;
      if (mode === "open-width") {
        setWidthText(formatLength(length, planUnits));
        setArm("open-offset");
        setNote("Width set. Shoot or type the offset from the corner.");
        return true;
      }
      if (mode === "open-offset") {
        setOffsetText(formatLength(length, planUnits));
        setNote("Offset set. Tap Place opening.");
        return true;
      }
      if (mode === "closet-width") {
        setCWidth(formatLength(length, planUnits));
        setArm("closet-depth");
        setNote("Width set. Shoot the depth.");
        return true;
      }
      if (mode === "closet-depth") {
        setCDepth(formatLength(length, planUnits));
        setNote("Depth set. Tap Add closet.");
        return true;
      }
      takeRef.current(shootMeters(histRef.current.present, meters, planUnits));
      return true;
    };
    return () => {
      undoRef.current = null;
      readingRef.current = null;
      onDraftRef.current(null);
    };
  }, [undoRef, readingRef]);

  const addTyped = () => {
    const n = parseLength(lengthText, units);
    if (n == null) {
      setNote(`Couldn't read "${lengthText}". Try 12'6" or 3.2`);
      return;
    }
    take(shoot(draft, n, units));
    setLengthText("");
  };

  const wall = currentWall(draft.closetChain ?? draft.points);
  const chain = draft.closetChain ?? draft.points;

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 flex max-h-[58%] flex-col rounded-t-3xl border-t border-black/10 bg-[#fbf7ed] shadow-[0_-8px_24px_rgba(0,0,0,0.15)]">
      <header className="flex items-center gap-2 border-b border-black/10 bg-white px-3 py-2">
        <h2 className="flex-1 text-lg font-bold">{draft.closetChain ? "Closet" : "Draw with laser"}</h2>
        <button type="button" onClick={() => undoRef.current?.()} disabled={hist.past.length === 0} className="h-11 rounded-full bg-black/5 px-3 text-sm font-semibold disabled:opacity-40">
          Undo
        </button>
        <button type="button" aria-label="Close draw with laser" onClick={onClose} className="flex size-12 items-center justify-center rounded-full bg-black/5">
          <X />
        </button>
      </header>
      <div className="min-h-0 space-y-3 overflow-y-auto p-3">
        {note && <p className="rounded-xl bg-[#f3dcc3] px-3 py-2 text-sm font-semibold">{note}</p>}
        <div className="flex items-center gap-2">
          <input
            aria-label="Room name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-11 min-w-0 flex-1 rounded-xl border border-black/15 bg-white px-3 text-base font-semibold"
          />
          <span className="text-sm text-black/50">{chain.length - 1} walls</span>
        </div>
        {panel === "pad" && (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              {(["up-left", "up", "up-right", "left", "center", "right", "down-left", "down", "down-right"] as const).map((id) => {
                if (id === "center") {
                  return (
                    <div key="center" className="flex items-center justify-center rounded-xl bg-black/5 text-xs font-semibold text-black/60">
                      {Math.round(draft.headingDeg)}°
                    </div>
                  );
                }
                const heading = HEADINGS.find((h) => h.id === id)!;
                const on = Math.round(draft.headingDeg) === heading.deg;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-label={heading.label}
                    aria-pressed={on}
                    onClick={() => {
                      const next = { ...draft, headingDeg: heading.deg };
                      setHist({ ...hist, present: next });
                      publish(next);
                    }}
                    className={`h-12 rounded-xl text-xl font-bold ${on ? "bg-[#b4561d] text-white" : "bg-white"}`}
                  >
                    {heading.arrow}
                  </button>
                );
              })}
            </div>
            <label className="flex items-center gap-2 text-sm">
              Custom angle
              <input
                aria-label="Custom wall angle in degrees clockwise from up"
                type="number"
                inputMode="decimal"
                value={String(draft.headingDeg)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  const deg = ((n % 360) + 360) % 360;
                  const next = { ...draft, headingDeg: deg };
                  setHist({ ...hist, present: next });
                  publish(next);
                }}
                className="h-11 w-24 rounded-xl border border-black/15 bg-white px-2 text-base"
              />
              <span className="text-black/50">° clockwise from up</span>
            </label>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addTyped();
              }}
            >
              <input
                aria-label="Wall length"
                value={lengthText}
                onChange={(e) => setLengthText(e.target.value)}
                placeholder={units === "ft" ? `12'6"` : "3.80"}
                className="h-12 min-w-0 flex-1 rounded-xl border border-black/15 bg-white px-3 text-lg"
              />
              <button type="submit" className="h-12 rounded-xl bg-black px-4 text-base font-bold text-white">
                Add wall
              </button>
            </form>
            {disto.mock && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = parseLength(mockText, units);
                  if (n == null) {
                    setNote("Couldn't read that simulated reading.");
                    return;
                  }
                  const err = publishMockMeters(planToMeters(n, units));
                  if (err) setNote(err);
                  setMockText("");
                }}
              >
                <input
                  aria-label="Simulated DISTO shot"
                  value={mockText}
                  onChange={(e) => setMockText(e.target.value)}
                  placeholder="Simulate DISTO shot"
                  className="h-12 min-w-0 flex-1 rounded-xl border border-black/15 bg-white px-3"
                />
                <button type="submit" className="h-12 rounded-xl bg-[#b4561d] px-3 text-sm font-bold text-white">
                  Shoot
                </button>
              </form>
            )}
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => { setPanel("opening"); setArm("open-width"); }} className="h-12 rounded-xl bg-white text-sm font-semibold">
                Add opening
              </button>
              <button type="button" onClick={() => { setPanel("closet"); setArm("closet-width"); }} className="h-12 rounded-xl bg-white text-sm font-semibold">
                Add closet
              </button>
              <button
                type="button"
                onClick={() => take(closeDraft(draft))}
                className="h-12 rounded-xl bg-[#b4561d] text-sm font-bold text-white"
              >
                Close room
              </button>
            </div>
            <p className="text-sm text-black/55">
              {wall
                ? `Current wall ${wall.index + 1} is ${formatLength(wall.length, units)}. Press DIST to add the next wall ${HEADINGS.find((h) => h.deg === Math.round(draft.headingDeg))?.label.toLowerCase() || "on this angle"}.`
                : "Pick a direction, then press DIST or type the first wall."}{" "}
              The room closes by itself when a shot lands within {units === "ft" ? "6 inches" : "15 cm"} of the start.
            </p>
          </>
        )}
        {panel === "opening" && (
          <OpeningForm
            units={units}
            kind={kind}
            setKind={setKind}
            widthText={widthText}
            setWidthText={setWidthText}
            offsetText={offsetText}
            setOffsetText={setOffsetText}
            transition={transition}
            setTransition={setTransition}
            onArm={(next) => setArm(next)}
            onCancel={() => { setPanel("pad"); setArm("wall"); }}
            onPlace={() => {
              const width = parseLength(widthText, units);
              const offset = parseLength(offsetText, units);
              if (width == null || offset == null) {
                setNote("Enter the width and the distance from the corner to the centre.");
                return;
              }
              const placed = addOpening(draft, { kind, width, offset, transition, id: uid("opening") });
              if (!placed.ok) {
                setNote(placed.reason);
                return;
              }
              setHist(pushDraft(hist, placed.draft));
              publish(placed.draft);
              setPanel("pad");
              setArm("wall");
              setNote(`${kind === "door" ? "Door" : kind === "cased" ? "Cased opening" : "Opening"} placed on wall ${placed.draft.openings.at(-1)!.wall + 1}.`);
            }}
          />
        )}
        {panel === "closet" && (
          <ClosetForm
            units={units}
            draft={draft}
            cWidth={cWidth}
            setCWidth={setCWidth}
            cDepth={cDepth}
            setCDepth={setCDepth}
            outward={outward}
            setOutward={setOutward}
            onArm={(next) => setArm(next)}
            onCancel={() => {
              if (draft.closetChain) {
                const cleared = { ...draft, closetChain: null };
                setHist(pushDraft(hist, cleared));
                publish(cleared);
              }
              setPanel("pad");
              setArm("wall");
            }}
            onInclude={(include) => setHist({ ...hist, present: { ...draft, closetInclude: include } })}
            onName={(closetName) => setHist({ ...hist, present: { ...draft, closetName } })}
            onRect={() => {
              const width = parseLength(cWidth, units);
              const depth = parseLength(cDepth, units);
              if (width == null || depth == null) {
                setNote("Enter the closet width and depth.");
                return;
              }
              const added = closetRectangle(draft, width, depth, outward, uid("closet"));
              if (!added.ok) {
                setNote(added.reason);
                return;
              }
              setHist(pushDraft(hist, added.draft));
              publish(added.draft);
              setPanel("pad");
              setArm("wall");
              setNote(added.draft.closetInclude ? "Closet added — included in the room total." : "Closet added — listed separately.");
            }}
            onArrows={() => {
              const started = startClosetChain(draft);
              if (!started.ok) {
                setNote(started.reason);
                return;
              }
              setHist(pushDraft(hist, started.draft));
              publish(started.draft);
              setPanel("pad");
              setArm("wall");
              setNote("Drawing the closet. Close it the same way, then close the room.");
            }}
          />
        )}
      </div>
    </div>
  );
}

function OpeningForm({
  units,
  kind,
  setKind,
  widthText,
  setWidthText,
  offsetText,
  setOffsetText,
  transition,
  setTransition,
  onArm,
  onCancel,
  onPlace,
}: {
  units: Units;
  kind: DraftOpening["kind"];
  setKind: (k: DraftOpening["kind"]) => void;
  widthText: string;
  setWidthText: (v: string) => void;
  offsetText: string;
  setOffsetText: (v: string) => void;
  transition: DraftOpening["transition"];
  setTransition: (v: DraftOpening["transition"]) => void;
  onArm: (arm: Arm) => void;
  onCancel: () => void;
  onPlace: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-black/60">On the current wall. The next DISTO shot fills the width, then the offset.</p>
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["door", "Door"],
            ["opening", "Opening"],
            ["cased", "Cased"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={kind === id} onClick={() => setKind(id)} className={`h-11 rounded-xl text-sm font-semibold ${kind === id ? "bg-black text-white" : "bg-white"}`}>
            {label}
          </button>
        ))}
      </div>
      <label className="block text-sm font-semibold">
        Width
        <input aria-label="Opening width" value={widthText} onFocus={() => onArm("open-width")} onChange={(e) => setWidthText(e.target.value)} placeholder={units === "ft" ? `2'8"` : "0.80"} className="mt-1 h-12 w-full rounded-xl border border-black/15 bg-white px-3 text-lg font-normal" />
      </label>
      <label className="block text-sm font-semibold">
        Centre, from the corner
        <input aria-label="Opening offset from corner" value={offsetText} onFocus={() => onArm("open-offset")} onChange={(e) => setOffsetText(e.target.value)} placeholder={units === "ft" ? `4'` : "1.20"} className="mt-1 h-12 w-full rounded-xl border border-black/15 bg-white px-3 text-lg font-normal" />
      </label>
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["auto", "Auto"],
            ["t-mold", "T-mold"],
            ["none", "No transition"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={transition === id} onClick={() => setTransition(id)} className={`h-11 rounded-xl text-sm font-semibold ${transition === id ? "bg-black text-white" : "bg-white"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="h-12 flex-1 rounded-xl bg-black/5 font-semibold">
          Cancel
        </button>
        <button type="button" onClick={onPlace} className="h-12 flex-1 rounded-xl bg-[#b4561d] font-bold text-white">
          Place opening
        </button>
      </div>
    </div>
  );
}

function ClosetForm({
  units,
  draft,
  cWidth,
  setCWidth,
  cDepth,
  setCDepth,
  outward,
  setOutward,
  onArm,
  onInclude,
  onName,
  onRect,
  onArrows,
  onCancel,
}: {
  units: Units;
  draft: Draft;
  cWidth: string;
  setCWidth: (v: string) => void;
  cDepth: string;
  setCDepth: (v: string) => void;
  outward: boolean;
  setOutward: (v: boolean) => void;
  onArm: (arm: Arm) => void;
  onInclude: (v: boolean) => void;
  onName: (v: string) => void;
  onRect: () => void;
  onArrows: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-black/60">Off the current wall. Width × depth, or the same arrows and DISTO shots.</p>
      <input aria-label="Closet name" value={draft.closetName} onChange={(e) => onName(e.target.value)} className="h-12 w-full rounded-xl border border-black/15 bg-white px-3 text-base" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-5" checked={draft.closetInclude} onChange={(e) => onInclude(e.target.checked)} />
        Include in the room's total
      </label>
      <label className="block text-sm font-semibold">
        Width
        <input aria-label="Closet width" value={cWidth} onFocus={() => onArm("closet-width")} onChange={(e) => setCWidth(e.target.value)} placeholder={units === "ft" ? `6'7"` : "2.00"} className="mt-1 h-12 w-full rounded-xl border border-black/15 bg-white px-3 text-lg font-normal" />
      </label>
      <label className="block text-sm font-semibold">
        Depth
        <input aria-label="Closet depth" value={cDepth} onFocus={() => onArm("closet-depth")} onChange={(e) => setCDepth(e.target.value)} placeholder={units === "ft" ? `7'4"` : "2.20"} className="mt-1 h-12 w-full rounded-xl border border-black/15 bg-white px-3 text-lg font-normal" />
      </label>
      <button type="button" aria-pressed={outward} onClick={() => setOutward(!outward)} className="h-11 rounded-xl bg-white px-3 text-sm font-semibold">
        {outward ? "Outside the room" : "Inside the room"}
      </button>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="h-12 flex-1 rounded-xl bg-black/5 font-semibold">
          Cancel
        </button>
        <button type="button" onClick={onArrows} className="h-12 flex-1 rounded-xl bg-white font-semibold">
          Arrow draw
        </button>
        <button type="button" onClick={onRect} className="h-12 flex-1 rounded-xl bg-[#b4561d] font-bold text-white">
          Add closet
        </button>
      </div>
    </div>
  );
}

function overlayOf(draft: Draft): PlanDraft {
  const openings = draft.openings.flatMap((o) => {
    const a = draft.points[o.wall];
    const b = draft.points[o.wall + 1];
    if (!a || !b) return [];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / L;
    const uy = (b.y - a.y) / L;
    const s = o.offset - o.width / 2;
    const e = o.offset + o.width / 2;
    return [
      {
        a: { x: a.x + ux * s, y: a.y + uy * s },
        b: { x: a.x + ux * e, y: a.y + uy * e },
      },
    ];
  });
  return {
    points: draft.points,
    closets: [
      ...draft.closets.map((c) => c.points),
      ...(draft.closetChain && draft.closetChain.length > 1 ? [draft.closetChain] : []),
    ],
    openings,
    openCloset: draft.closetChain,
    preview: previewEnd(draft, 2),
  };
}
