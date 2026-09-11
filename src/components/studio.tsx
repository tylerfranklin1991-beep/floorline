import { ArrowLeft, Maximize2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { usePlanStore } from "@/lib/floorplan/store";
import { Drawer } from "vaul";
import { Inspector } from "./inspector";
import { FloorlineMark } from "./mark";
import { PlanCanvas } from "./plan-canvas";
import { ExportMenu, Toolbar } from "./toolbar";
import { Button } from "./ui/button";
import { CommandMenu } from "./command-menu";

export function Studio() {
  const plan = usePlanStore((s) => s.plan);
  const style = usePlanStore((s) => s.style);
  const layers = usePlanStore((s) => s.layers);
  const selectedRoomId = usePlanStore((s) => s.selectedRoomId);
  const selectedFurnitureId = usePlanStore((s) => s.selectedFurnitureId);
  const selectRoom = usePlanStore((s) => s.selectRoom);
  const selectFurniture = usePlanStore((s) => s.selectFurniture);
  const moveFurniture = usePlanStore((s) => s.moveFurniture);
  const saveCurrent = usePlanStore((s) => s.saveCurrent);
  const reset = usePlanStore((s) => s.reset);
  const svgRef = useRef<SVGSVGElement>(null);
  const [fitToken, setFitToken] = useState(0);
  const [inspectOpen, setInspectOpen] = useState(false);

  if (!plan) return null;

  const openInspector = () => setInspectOpen(true);
  const onPhone = () => window.matchMedia("(max-width: 767px)").matches;

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="studio-header relative z-20 border-b border-border px-page">
        <Button type="button" size="icon" variant="ghost" className="tap-target relative z-20" onClick={reset} aria-label="Back">
          <ArrowLeft className="size-4" />
        </Button>
        <CommandMenu
          surface="studio"
          svgRef={svgRef}
          onFit={() => setFitToken((n) => n + 1)}
          onRooms={openInspector}
        />
        <FloorlineMark className="studio-mark" />
        <div className="studio-title">
          <p className="truncate text-sm text-foreground">{plan.title}</p>
        </div>
        <div className="studio-desk-toolbar">
          <Toolbar svgRef={svgRef} onFit={() => setFitToken((n) => n + 1)} />
        </div>
        <div className="studio-phone-actions">
          <ExportMenu svgRef={svgRef} />
          <Button
            type="button"
            size="sm"
            variant="paper"
            className="tap-target"
            onClick={() => {
              saveCurrent();
              toast("Sheet saved on this device");
            }}
          >
            Save
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 bg-desk">
          <PlanCanvas
            plan={plan}
            style={style}
            layers={layers}
            selectedRoomId={selectedRoomId}
            selectedFurnitureId={selectedFurnitureId}
            onSelectRoom={(id) => {
              selectRoom(id);
              if (id && onPhone()) openInspector();
            }}
            onSelectFurniture={(id) => {
              selectFurniture(id);
              if (id && onPhone()) openInspector();
            }}
            onMoveFurniture={moveFurniture}
            fitToken={fitToken}
            svgRef={svgRef}
          />
          <p className="studio-hint-desk pointer-events-none absolute bottom-3 left-3 text-xs text-muted-foreground">
            Scroll to zoom · drag to pan · drag furniture to place
          </p>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="studio-fit pointer-events-auto absolute top-3 left-3 z-10 tap-target"
            aria-label="Fit sheet"
            onClick={() => setFitToken((n) => n + 1)}
          >
            <Maximize2 className="size-4" />
          </Button>
        </div>
        <div className="studio-sidebar border-l border-border bg-card">
          <Inspector />
        </div>
      </div>

      <div className={`studio-phone-bar border-t border-border px-page ${inspectOpen ? "is-hidden" : ""}`}>
        <Toolbar
          svgRef={svgRef}
          onFit={() => setFitToken((n) => n + 1)}
          compact
          trailing={
            <Button type="button" variant="outline" className="h-11 min-h-11 flex-1" onClick={openInspector}>
              Rooms
            </Button>
          }
        />
      </div>

      <Drawer.Root open={inspectOpen} onOpenChange={setInspectOpen} shouldScaleBackground={false} modal>
        <Drawer.Portal>
          <Drawer.Overlay className="studio-drawer fixed inset-0 z-50 bg-background/70" />
          <Drawer.Content className="studio-drawer fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border border-border bg-card outline-none">
            <div className="flex justify-center pt-3">
              <span className="h-1 w-10 rounded-full bg-border" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <Inspector />
            </div>
            <div className="border-t border-border px-4 pt-3 pb-safe">
              <Button type="button" variant="outline" className="h-11 w-full tap-target" onClick={() => setInspectOpen(false)}>
                Close
              </Button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
