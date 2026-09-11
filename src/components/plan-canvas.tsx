import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sheetLayout } from "@/lib/floorplan/format";
import { usePlanStore } from "@/lib/floorplan/store";
import type { FloorPlan, PlanLayers, PlanStyle } from "@/lib/floorplan/types";
import { PlanSheet } from "./plan-sheet";
import { cn } from "@/lib/utils";

type Props = {
  plan: FloorPlan;
  style: PlanStyle;
  layers: PlanLayers;
  selectedRoomId: string | null;
  selectedFurnitureId: string | null;
  onSelectRoom: (id: string | null) => void;
  onSelectFurniture: (id: string | null) => void;
  onMoveFurniture?: (id: string, x: number, y: number) => void;
  fitToken?: number;
  className?: string;
  svgRef?: React.RefObject<SVGSVGElement | null>;
};

type View = { x: number; y: number; w: number; h: number };

export function PlanCanvas({
  plan,
  style,
  layers,
  selectedRoomId,
  selectedFurnitureId,
  onSelectRoom,
  onSelectFurniture,
  onMoveFurniture,
  fitToken = 0,
  className,
  svgRef,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const localSvg = useRef<SVGSVGElement>(null);
  const svg = svgRef ?? localSvg;
  const layout = useMemo(() => sheetLayout(plan), [plan]);
  const fitted = useMemo<View>(() => {
    const pad = Math.max(layout.w, layout.h) * 0.045;
    return {
      x: layout.x - pad,
      y: layout.y - pad,
      w: layout.w + pad * 2,
      h: layout.h + pad * 2,
    };
  }, [layout]);
  const [view, setView] = useState<View>(fitted);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const pinch = useRef<{ dist: number; view: View } | null>(null);
  const suppressClick = useRef(false);
  const sketchNonce = usePlanStore((s) => s.sketchNonce);
  const [sketching, setSketching] = useState(true);
  const seenNonce = useRef(sketchNonce);
  if (seenNonce.current !== sketchNonce) {
    seenNonce.current = sketchNonce;
    if (!sketching) setSketching(true);
  }

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setSketching(false);
      return;
    }
    setSketching(true);
    const timer = window.setTimeout(() => setSketching(false), 3400);
    return () => window.clearTimeout(timer);
  }, [plan.id, sketchNonce]);

  useEffect(() => {
    setView(fitted);
  }, [fitted, plan.id, fitToken]);

  const clientToSvg = useCallback(
    (clientX: number, clientY: number) => {
      const el = svg.current;
      if (!el) return { x: 0, y: 0 };
      const pt = el.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const ctm = el.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      const mapped = pt.matrixTransform(ctm.inverse());
      return { x: mapped.x, y: mapped.y };
    },
    [svg],
  );

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 1.08 : 0.92;
      setView((prev) => {
        const cursor = clientToSvg(event.clientX, event.clientY);
        const nextW = Math.min(layout.w * 3.2, Math.max(layout.w * 0.28, prev.w * factor));
        const nextH = nextW * (prev.h / prev.w);
        const rx = (cursor.x - prev.x) / prev.w;
        const ry = (cursor.y - prev.y) / prev.h;
        return {
          x: cursor.x - rx * nextW,
          y: cursor.y - ry * nextH,
          w: nextW,
          h: nextH,
        };
      });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [clientToSvg, layout.w]);

  return (
    <div
      ref={wrapRef}
      className={cn("relative h-full w-full overflow-hidden touch-none", `theme-${style}`, className)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        event.currentTarget.setPointerCapture(event.pointerId);

        if (pointers.current.size === 2) {
          pan.current = null;
          drag.current = null;
          const pts = [...pointers.current.values()];
          const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          pinch.current = { dist: Math.max(1, dist), view: viewRef.current };
          return;
        }

        const target = event.target as Element;
        const furn = target.closest("[data-furn]");
        if (furn && onMoveFurniture) {
          const id = furn.getAttribute("data-furn");
          const item = plan.furniture.find((entry) => entry.id === id);
          if (id && item) {
            const pt = clientToSvg(event.clientX, event.clientY);
            drag.current = { id, dx: pt.x - item.x, dy: pt.y - item.y, moved: false };
            onSelectFurniture(id);
            return;
          }
        }
        if (target.closest(".plan-room, .plan-furniture, .plan-furn-selected")) return;
        const current = viewRef.current;
        pan.current = { x: event.clientX, y: event.clientY, vx: current.x, vy: current.y };
      }}
      onPointerMove={(event) => {
        if (pointers.current.has(event.pointerId)) {
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        }

        if (pinch.current && pointers.current.size >= 2 && svg.current) {
          const pts = [...pointers.current.values()];
          const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          const factor = pinch.current.dist / Math.max(40, dist);
          const start = pinch.current.view;
          const nextW = Math.min(layout.w * 3.2, Math.max(layout.w * 0.28, start.w * factor));
          const nextH = nextW * (start.h / start.w);
          const rect = svg.current.getBoundingClientRect();
          const mx = (pts[0].x + pts[1].x) / 2;
          const my = (pts[0].y + pts[1].y) / 2;
          const rx = (mx - rect.left) / rect.width;
          const ry = (my - rect.top) / rect.height;
          const cx = start.x + rx * start.w;
          const cy = start.y + ry * start.h;
          suppressClick.current = true;
          setView({
            x: cx - rx * nextW,
            y: cy - ry * nextH,
            w: nextW,
            h: nextH,
          });
          return;
        }

        if (drag.current && onMoveFurniture) {
          const item = plan.furniture.find((entry) => entry.id === drag.current?.id);
          if (!item) return;
          const pt = clientToSvg(event.clientX, event.clientY);
          const x = pt.x - drag.current.dx;
          const y = pt.y - drag.current.dy;
          if (Math.hypot(x - item.x, y - item.y) > 0.08) drag.current.moved = true;
          const maxX = Math.max(0, plan.overallWidth - item.w);
          const maxY = Math.max(0, plan.overallDepth - item.h);
          onMoveFurniture(item.id, Math.min(maxX, Math.max(-item.w * 0.15, x)), Math.min(maxY, Math.max(-item.h * 0.15, y)));
          suppressClick.current = drag.current.moved;
          return;
        }

        if (!pan.current || !svg.current) return;
        const rect = svg.current.getBoundingClientRect();
        const dx = ((event.clientX - pan.current.x) / rect.width) * viewRef.current.w;
        const dy = ((event.clientY - pan.current.y) / rect.height) * viewRef.current.h;
        if (Math.hypot(dx, dy) > 0.12) suppressClick.current = true;
        setView((prev) => ({ ...prev, x: pan.current!.vx - dx, y: pan.current!.vy - dy }));
      }}
      onPointerUp={(event) => {
        pointers.current.delete(event.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
        pan.current = null;
        drag.current = null;
      }}
      onPointerCancel={(event) => {
        pointers.current.delete(event.pointerId);
        pinch.current = null;
        pan.current = null;
        drag.current = null;
      }}
    >
      <svg
        ref={svg}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        className="h-full w-full select-none"
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          onSelectRoom(null);
          onSelectFurniture(null);
        }}
        role="img"
        aria-label={`${plan.title} floor plan`}
      >
        <PlanSheet
          key={`${plan.id}-${sketchNonce}`}
          plan={plan}
          style={style}
          layers={layers}
          selectedRoomId={selectedRoomId}
          selectedFurnitureId={selectedFurnitureId}
          onSelectRoom={onSelectRoom}
          onSelectFurniture={onSelectFurniture}
          sketching={sketching}
        />
      </svg>
    </div>
  );
}

export function MiniPlan({ plan, className }: { plan: FloorPlan; className?: string }) {
  const layout = sheetLayout(plan);
  return (
    <svg
      viewBox={`${layout.x} ${layout.y} ${layout.w} ${layout.h}`}
      className={cn("h-full w-full theme-sheet", className)}
      role="img"
      aria-label={`${plan.title} preview`}
    >
      <PlanSheet
        plan={plan}
        style="sheet"
        layers={{ grid: true, labels: true, dimensions: false, furniture: true, openings: true }}
        selectedRoomId={null}
        selectedFurnitureId={null}
        interactive={false}
        compact
      />
    </svg>
  );
}
