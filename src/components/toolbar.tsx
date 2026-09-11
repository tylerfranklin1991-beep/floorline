import { Download, Frame, Grid3x3, Layers, Pencil, Sofa, Type } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { exportJson, exportPngElement, exportSvgElement, slugTitle } from "@/lib/floorplan/export";
import { usePlanStore } from "@/lib/floorplan/store";
import type { PlanLayers, PlanStyle } from "@/lib/floorplan/types";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const STYLES: { id: PlanStyle; label: string; short: string }[] = [
  { id: "sheet", label: "Sheet", short: "Sheet" },
  { id: "blueprint", label: "Blueprint", short: "Blue" },
  { id: "ink", label: "Ink", short: "Ink" },
  { id: "sketch", label: "Sketch", short: "Sketch" },
];

const LAYER_ITEMS: { id: keyof PlanLayers; label: string; icon: typeof Grid3x3 }[] = [
  { id: "grid", label: "Grid", icon: Grid3x3 },
  { id: "labels", label: "Labels", icon: Type },
  { id: "dimensions", label: "Dimensions", icon: Frame },
  { id: "furniture", label: "Furniture", icon: Sofa },
  { id: "openings", label: "Openings", icon: Layers },
];

export function Toolbar({
  svgRef,
  onFit,
  compact = false,
  trailing,
}: {
  svgRef: React.RefObject<SVGSVGElement | null>;
  onFit: () => void;
  compact?: boolean;
  trailing?: ReactNode;
}) {
  const plan = usePlanStore((s) => s.plan);
  const style = usePlanStore((s) => s.style);
  const layers = usePlanStore((s) => s.layers);
  const setStyle = usePlanStore((s) => s.setStyle);
  const toggleLayer = usePlanStore((s) => s.toggleLayer);
  const saveCurrent = usePlanStore((s) => s.saveCurrent);
  const replaySketch = usePlanStore((s) => s.replaySketch);

  if (!plan) return null;
  const filename = slugTitle(plan.title);

  const styleSwitch = (
    <div className={`flex rounded-lg bg-secondary p-1 ${compact ? "w-full" : "shrink-0"}`}>
      {STYLES.map((entry) => (
        <button
          key={entry.id}
          type="button"
          aria-pressed={style === entry.id}
          aria-label={entry.label}
          onClick={() => setStyle(entry.id)}
          className={`${
            compact ? "h-11 min-h-11 flex-1 px-1 text-xs whitespace-nowrap" : "h-9 px-3 text-sm"
          } rounded-md transition-colors duration-150 ${
            style === entry.id ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {compact ? entry.short : entry.label}
        </button>
      ))}
    </div>
  );

  const exportMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size={compact ? "icon" : "sm"} variant="outline" aria-label="Export">
          <Download className="size-4" />
          {compact ? null : "Export"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={async () => {
            if (!svgRef.current) return;
            await exportSvgElement(svgRef.current, filename);
            toast("SVG saved");
          }}
        >
          SVG
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={async () => {
            if (!svgRef.current) return;
            await exportPngElement(svgRef.current, plan, filename, style);
            toast("PNG saved");
          }}
        >
          PNG
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            exportJson(plan, filename);
            toast("JSON saved");
          }}
        >
          JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (compact) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {styleSwitch}
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon" variant="outline" className="tap-target shrink-0" aria-label="Layers">
                <Layers className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              {LAYER_ITEMS.map((item) => (
                <DropdownMenuCheckboxItem
                  key={item.id}
                  checked={layers[item.id]}
                  onCheckedChange={() => toggleLayer(item.id)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {item.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="tap-target shrink-0"
            aria-label="Replay sketch"
            onClick={() => replaySketch()}
          >
            <Pencil className="size-4" />
          </Button>
          {trailing}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto">
      {styleSwitch}

      {LAYER_ITEMS.map((item) => {
        const Icon = item.icon;
        const on = layers[item.id];
        return (
          <Button
            key={item.id}
            type="button"
            size="icon-sm"
            variant={on ? "secondary" : "ghost"}
            aria-pressed={on}
            aria-label={item.label}
            title={item.label}
            onClick={() => toggleLayer(item.id)}
          >
            <Icon className="size-4" />
          </Button>
        );
      })}

      <Button type="button" size="icon-sm" variant="ghost" aria-label="Replay sketch" title="Sketch again" onClick={() => replaySketch()}>
        <Pencil className="size-4" />
      </Button>

      <Button type="button" size="sm" variant="ghost" onClick={onFit}>
        Fit
      </Button>

      {exportMenu}

      <Button
        type="button"
        size="sm"
        variant="paper"
        onClick={() => {
          saveCurrent();
          toast("Sheet saved on this device");
        }}
      >
        Save
      </Button>
    </div>
  );
}

export function ExportMenu({ svgRef }: { svgRef: React.RefObject<SVGSVGElement | null> }) {
  const plan = usePlanStore((s) => s.plan);
  const style = usePlanStore((s) => s.style);
  if (!plan) return null;
  const filename = slugTitle(plan.title);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon" variant="ghost" className="tap-target" aria-label="Export">
          <Download className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={async () => {
            if (!svgRef.current) return;
            await exportSvgElement(svgRef.current, filename);
            toast("SVG saved");
          }}
        >
          SVG
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={async () => {
            if (!svgRef.current) return;
            await exportPngElement(svgRef.current, plan, filename, style);
            toast("PNG saved");
          }}
        >
          PNG
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            exportJson(plan, filename);
            toast("JSON saved");
          }}
        >
          JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
