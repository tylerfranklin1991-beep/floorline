import {
  Bluetooth,
  BluetoothOff,
  Camera,
  ChevronDown,
  Compass,
  Download,
  Home,
  ImageIcon,
  Maximize2,
  Pencil,
  Ruler,
  Save,
  X,
} from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { connectDisto, disconnectDisto, distoSupportMessage, isDistoSupported, triggerDistoMeasure } from "@/lib/floorplan/disto";
import { exportJson, exportPngElement, exportSvgElement, slugTitle } from "@/lib/floorplan/export";
import { formatLength, fromMeters } from "@/lib/floorplan/format";
import { usePlanStore } from "@/lib/floorplan/store";
import type { PlanStyle } from "@/lib/floorplan/types";
import { Button } from "./ui/button";

type HomeActions = {
  surface: "home";
  onPhotos?: () => void;
  onCamera?: () => void;
  onWalk?: () => void;
  onSample?: () => void;
  onTrace?: () => void;
  onDraft?: () => void;
  canDraft?: boolean;
};

type StudioActions = {
  surface: "studio";
  svgRef: React.RefObject<SVGSVGElement | null>;
  onFit: () => void;
  onRooms: () => void;
};

type Props = HomeActions | StudioActions;

const STYLES: { id: PlanStyle; label: string }[] = [
  { id: "sheet", label: "Sheet" },
  { id: "blueprint", label: "Blueprint" },
  { id: "ink", label: "Ink" },
  { id: "sketch", label: "Sketch" },
];

export function CommandMenu(props: Props) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const plan = usePlanStore((s) => s.plan);
  const view = usePlanStore((s) => s.view);
  const status = usePlanStore((s) => s.status);
  const unitsPref = usePlanStore((s) => s.unitsPref);
  const setUnitsPref = usePlanStore((s) => s.setUnitsPref);
  const setPlanUnits = usePlanStore((s) => s.setPlanUnits);
  const setView = usePlanStore((s) => s.setView);
  const reset = usePlanStore((s) => s.reset);
  const openSample = usePlanStore((s) => s.openSample);
  const saveCurrent = usePlanStore((s) => s.saveCurrent);
  const replaySketch = usePlanStore((s) => s.replaySketch);
  const setStyle = usePlanStore((s) => s.setStyle);
  const style = usePlanStore((s) => s.style);
  const cancelWork = usePlanStore((s) => s.cancelWork);
  const distoStatus = usePlanStore((s) => s.distoStatus);
  const distoName = usePlanStore((s) => s.distoName);
  const distoMeters = usePlanStore((s) => s.distoMeters);
  const distoError = usePlanStore((s) => s.distoError);
  const setDisto = usePlanStore((s) => s.setDisto);
  const applyDisto = usePlanStore((s) => s.applyDisto);
  const selectedRoomId = usePlanStore((s) => s.selectedRoomId);
  const busy = status === "preparing" || status === "analyzing";

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => setOpen(false);
  const run = (fn?: () => void) => {
    close();
    fn?.();
  };

  const connectLaser = async () => {
    close();
    if (!isDistoSupported()) {
      setDisto({ distoStatus: "unsupported", distoError: distoSupportMessage() });
      toast(distoSupportMessage());
      return;
    }
    setDisto({ distoStatus: "connecting", distoError: null });
    try {
      const { name } = await connectDisto({
        onReading: (reading) => {
          setDisto({
            distoStatus: "connected",
            distoName: reading.name,
            distoMeters: reading.meters,
            distoAt: Date.now(),
            distoError: null,
          });
          toast(`DISTO ${formatLength(fromMeters(reading.meters, unitsPref), unitsPref)}`);
        },
        onDisconnect: () => {
          setDisto({ distoStatus: "off", distoName: null });
        },
      });
      setDisto({ distoStatus: "connected", distoName: name, distoError: null });
      toast(`Connected to ${name}`);
    } catch (err) {
      const errName = err instanceof Error ? err.name : "";
      if (errName === "NotFoundError") {
        setDisto({ distoStatus: "off", distoError: null });
        return;
      }
      const message = err instanceof Error ? err.message : "Could not reach the DISTO.";
      setDisto({ distoStatus: "off", distoError: message });
      toast(message);
    }
  };

  const units = plan?.units ?? unitsPref;
  const lastShot = distoMeters != null ? formatLength(fromMeters(distoMeters, units), units) : null;

  const row = (label: string, onClick: () => void, icon?: ReactNode, disabled?: boolean) => (
    <button key={label} type="button" disabled={disabled} onClick={onClick} className="command-item">
      {icon}
      <span>{label}</span>
    </button>
  );

  const panel = open ? (
    <div className="command-layer">
      <button type="button" className="command-backdrop" aria-label="Close commands" onClick={close} />
      <div className="command-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="command-panel-head">
          <p id={titleId} className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Commands
          </p>
          <Button type="button" size="icon" variant="ghost" className="tap-target" onClick={close} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
        <div className="command-list">
          {props.surface === "home" && (
            <>
              {row("Open sample loft", () => run(openSample))}
              {plan ? row("Resume plan", () => run(() => setView("studio"))) : null}
              {row("Photos", () => run(props.onPhotos), <ImageIcon className="size-4" />, busy)}
              {row("Camera", () => run(props.onCamera), <Camera className="size-4" />, busy)}
              {row("Guided walk", () => run(props.onWalk), <Compass className="size-4" />, busy)}
              {row("Trace sample rooms", () => run(props.onTrace), undefined, busy)}
              {props.canDraft ? row("Draft plan", () => run(props.onDraft), undefined, busy) : null}
              {busy ? row("Cancel tracing", () => run(cancelWork)) : null}
            </>
          )}
          {props.surface === "studio" && plan ? (
            <>
              {row("Home", () => run(reset), <Home className="size-4" />)}
              {row("Fit sheet", () => run(props.onFit), <Maximize2 className="size-4" />)}
              {row("Rooms & dimensions", () => run(props.onRooms), <Ruler className="size-4" />)}
              {row("Sketch again", () => run(replaySketch), <Pencil className="size-4" />)}
              {row(
                "Save on this device",
                () =>
                  run(() => {
                    saveCurrent();
                    toast("Sheet saved on this device");
                  }),
                <Save className="size-4" />,
              )}
              {row(
                "Export SVG",
                () =>
                  run(() => {
                    if (!props.svgRef.current) return;
                    void exportSvgElement(props.svgRef.current, slugTitle(plan.title));
                    toast("SVG saved");
                  }),
                <Download className="size-4" />,
              )}
              {row(
                "Export PNG",
                () =>
                  run(() => {
                    if (!props.svgRef.current) return;
                    void exportPngElement(props.svgRef.current, plan, slugTitle(plan.title), style);
                    toast("PNG saved");
                  }),
                <Download className="size-4" />,
              )}
              {row(
                "Export JSON",
                () =>
                  run(() => {
                    exportJson(plan, slugTitle(plan.title));
                    toast("JSON saved");
                  }),
                <Download className="size-4" />,
              )}
              <p className="command-label">Sheet style</p>
              <div className="command-chips">
                {STYLES.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={style === entry.id}
                    onClick={() => {
                      setStyle(entry.id);
                      close();
                    }}
                    className={`command-chip ${style === entry.id ? "is-on" : ""}`}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <p className="command-label">Units</p>
          <div className="command-chips">
            {(["ft", "m"] as const).map((unit) => (
              <button
                key={unit}
                type="button"
                aria-pressed={units === unit}
                onClick={() => {
                  if (view === "studio" && plan) setPlanUnits(unit);
                  else setUnitsPref(unit);
                }}
                className={`command-chip ${units === unit ? "is-on" : ""}`}
              >
                {unit === "ft" ? "Feet" : "Metres"}
              </button>
            ))}
          </div>

          <p className="command-label">Leica DISTO D2</p>
          {distoStatus === "connected" ? (
            <>
              <p className="command-note">
                {distoName || "DISTO D2"}
                {lastShot ? ` · last ${lastShot}` : " · take a shot on the laser"}
              </p>
              {row("Trigger DISTO shot", () => void triggerDistoMeasure(), <Bluetooth className="size-4" />)}
              {plan && selectedRoomId && distoMeters != null
                ? row("Apply as room width", () => {
                    applyDisto("w");
                    close();
                    toast("Width updated from DISTO");
                  })
                : null}
              {plan && selectedRoomId && distoMeters != null
                ? row("Apply as room depth", () => {
                    applyDisto("h");
                    close();
                    toast("Depth updated from DISTO");
                  })
                : null}
              {row(
                "Disconnect DISTO",
                () => {
                  void disconnectDisto();
                  setDisto({ distoStatus: "off", distoName: null });
                  close();
                },
                <BluetoothOff className="size-4" />,
              )}
            </>
          ) : (
            <>
              <p className="command-note">
                {distoError ||
                  (distoStatus === "unsupported"
                    ? distoSupportMessage()
                    : "Hold the DISTO Bluetooth key for two seconds, then connect. Chrome or Edge on Android or desktop.")}
              </p>
              {row(
                distoStatus === "connecting" ? "Connecting…" : "Connect DISTO D2",
                () => void connectLaser(),
                <Bluetooth className="size-4" />,
                distoStatus === "connecting",
              )}
            </>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <Button
        type="button"
        variant="paper"
        className="command-trigger tap-target"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Commands
        <ChevronDown className="size-4" />
      </Button>
      {typeof document !== "undefined" && panel ? createPortal(panel, document.body) : null}
    </>
  );
}
