import { formatArea, formatLength, scaleMajor, sheetLayout, siteCaption, sourceCaption } from "@/lib/floorplan/format";
import type { FloorPlan, Furniture, Opening, PlanLayers, PlanStyle, Room, WallSide } from "@/lib/floorplan/types";

type Props = {
  plan: FloorPlan;
  style: PlanStyle;
  layers: PlanLayers;
  selectedRoomId: string | null;
  selectedFurnitureId: string | null;
  onSelectRoom?: (id: string | null) => void;
  onSelectFurniture?: (id: string | null) => void;
  onMoveFurniture?: (id: string, x: number, y: number) => void;
  interactive?: boolean;
  compact?: boolean;
  sketching?: boolean;
};

function roomFill(type: Room["type"]): string {
  return `var(--color-room-${type})`;
}

function furnitureKind(kind: string): string {
  const k = kind.toLowerCase();
  if (k.includes("bed")) return "bed";
  if (k.includes("sofa") || k.includes("couch")) return "sofa";
  if (k.includes("island")) return "island";
  if (k.includes("fridge") || k.includes("refriger")) return "fridge";
  if (k.includes("stove") || k.includes("range") || k.includes("cook")) return "stove";
  if (k.includes("sink") || k.includes("vanity")) return "sink";
  if (k.includes("toilet") || k === "wc") return "toilet";
  if (k.includes("shower")) return "shower";
  if (k.includes("tub") || k.includes("bath")) return "bathtub";
  if (k.includes("desk")) return "desk";
  if (k.includes("tv") || k.includes("media") || k.includes("console")) return "tv";
  if (k.includes("wardrobe") || k.includes("closet") || k.includes("armoire")) return "wardrobe";
  if (k.includes("night")) return "nightstand";
  if (k.includes("plant")) return "plant";
  if (k.includes("table") || k.includes("coffee") || k.includes("dining")) return "table";
  if (k.includes("chair")) return "chair";
  return "block";
}

function wallSegment(room: Room, wall: WallSide, offset: number, width: number) {
  const o = Math.max(0, offset);
  const w = Math.max(0.4, width);
  switch (wall) {
    case "n":
      return { x1: room.x + o, y1: room.y, x2: room.x + o + w, y2: room.y, dir: "h" as const, inward: 1 };
    case "s":
      return { x1: room.x + o, y1: room.y + room.h, x2: room.x + o + w, y2: room.y + room.h, dir: "h" as const, inward: -1 };
    case "w":
      return { x1: room.x, y1: room.y + o, x2: room.x, y2: room.y + o + w, dir: "v" as const, inward: 1 };
    case "e":
      return { x1: room.x + room.w, y1: room.y + o, x2: room.x + room.w, y2: room.y + o + w, dir: "v" as const, inward: -1 };
  }
}

function DoorSymbol({ room, opening }: { room: Room; opening: Opening }) {
  const seg = wallSegment(room, opening.wall, opening.offset, opening.width);
  const len = opening.width;
  const hingeLeft = opening.swing.includes("left");
  const swingsIn = opening.swing.startsWith("in") || opening.swing === "none";
  const sign = (swingsIn ? 1 : -1) * seg.inward;

  const hingeX = hingeLeft ? seg.x1 : seg.x2;
  const hingeY = hingeLeft ? seg.y1 : seg.y2;
  let leafX = hingeLeft ? seg.x2 : seg.x1;
  let leafY = hingeLeft ? seg.y2 : seg.y1;

  if (seg.dir === "h") {
    leafX = hingeX;
    leafY = hingeY + sign * len;
  } else {
    leafX = hingeX + sign * len;
    leafY = hingeY;
  }

  let sweepFlag = 1;
  if (seg.dir === "h") {
    if (sign > 0) sweepFlag = hingeLeft ? 1 : 0;
    else sweepFlag = hingeLeft ? 0 : 1;
  } else if (sign > 0) {
    sweepFlag = hingeLeft ? 0 : 1;
  } else {
    sweepFlag = hingeLeft ? 1 : 0;
  }

  const arcEndX = seg.dir === "h" ? (hingeLeft ? seg.x2 : seg.x1) : hingeX;
  const arcEndY = seg.dir === "h" ? hingeY : hingeLeft ? seg.y2 : seg.y1;
  const arc = `M ${leafX} ${leafY} A ${len} ${len} 0 0 ${sweepFlag} ${arcEndX} ${arcEndY}`;

  return (
    <g className="plan-opening">
      <line
        x1={seg.x1}
        y1={seg.y1}
        x2={seg.x2}
        y2={seg.y2}
        className="plan-gap"
        strokeWidth={0.55}
        strokeLinecap="butt"
      />
      {opening.kind === "opening" || opening.kind === "sliding" ? (
        <>
          <line
            x1={seg.x1}
            y1={seg.y1}
            x2={seg.x2}
            y2={seg.y2}
            className="plan-ink"
            strokeWidth={0.06}
            strokeDasharray={opening.kind === "sliding" ? "0.18 0.12" : undefined}
            opacity={0.7}
          />
        </>
      ) : (
        <>
          <line x1={hingeX} y1={hingeY} x2={leafX} y2={leafY} className="plan-ink" strokeWidth={0.07} />
          <path d={arc} className="plan-swing" fill="none" strokeWidth={0.045} />
        </>
      )}
    </g>
  );
}

function WindowSymbol({ room, opening }: { room: Room; opening: Opening }) {
  const seg = wallSegment(room, opening.wall, opening.offset, opening.width);
  const inset = 0.14;
  const nx = seg.dir === "h" ? 0 : 1;
  const ny = seg.dir === "h" ? 1 : 0;
  return (
    <g className="plan-opening">
      <line
        x1={seg.x1}
        y1={seg.y1}
        x2={seg.x2}
        y2={seg.y2}
        className="plan-gap"
        strokeWidth={0.55}
        strokeLinecap="butt"
      />
      <line
        x1={seg.x1 + nx * inset}
        y1={seg.y1 + ny * inset}
        x2={seg.x2 + nx * inset}
        y2={seg.y2 + ny * inset}
        className="plan-ink"
        strokeWidth={0.07}
      />
      <line
        x1={seg.x1 - nx * inset}
        y1={seg.y1 - ny * inset}
        x2={seg.x2 - nx * inset}
        y2={seg.y2 - ny * inset}
        className="plan-ink"
        strokeWidth={0.07}
      />
    </g>
  );
}

function FurnitureSymbol({ item }: { item: Furniture }) {
  const kind = furnitureKind(item.kind);
  const cx = item.w / 2;
  const cy = item.h / 2;
  const sw = Math.max(0.045, Math.min(item.w, item.h) * 0.035);

  return (
    <g className="plan-furniture" transform={`translate(${item.x} ${item.y}) rotate(${item.rotation} ${cx} ${cy})`}>
      {kind === "bed" && (
        <>
          <rect x={0} y={0} width={item.w} height={item.h} rx={0.18} className="plan-furn-fill plan-furn-stroke" strokeWidth={sw} />
          <rect
            x={0.18}
            y={0.18}
            width={item.w - 0.36}
            height={Math.min(1.5, item.h * 0.28)}
            rx={0.1}
            className="plan-furn-stroke"
            fill="none"
            strokeWidth={sw}
          />
          <line
            x1={item.w * 0.5}
            y1={0.18}
            x2={item.w * 0.5}
            y2={Math.min(1.5, item.h * 0.28) + 0.18}
            className="plan-furn-stroke"
            strokeWidth={sw}
          />
        </>
      )}
      {kind === "sofa" && (
        <>
          <rect x={0} y={0} width={item.w} height={item.h} rx={0.28} className="plan-furn-fill plan-furn-stroke" strokeWidth={sw} />
          <rect
            x={0.18}
            y={0.16}
            width={item.w - 0.36}
            height={item.h * 0.42}
            rx={0.16}
            className="plan-furn-stroke"
            fill="none"
            strokeWidth={sw}
          />
        </>
      )}
      {kind === "table" && (
        <ellipse
          cx={cx}
          cy={cy}
          rx={item.w / 2}
          ry={item.h / 2}
          className="plan-furn-fill plan-furn-stroke"
          strokeWidth={sw}
        />
      )}
      {kind === "island" && (
        <rect x={0} y={0} width={item.w} height={item.h} rx={0.12} className="plan-furn-fill plan-furn-stroke" strokeWidth={sw} />
      )}
      {kind === "fridge" && (
        <>
          <rect x={0} y={0} width={item.w} height={item.h} rx={0.08} className="plan-furn-fill plan-furn-stroke" strokeWidth={sw} />
          <line x1={0} y1={item.h * 0.38} x2={item.w} y2={item.h * 0.38} className="plan-furn-stroke" strokeWidth={sw} />
        </>
      )}
      {kind === "stove" && (
        <>
          <rect x={0} y={0} width={item.w} height={item.h} rx={0.08} className="plan-furn-fill plan-furn-stroke" strokeWidth={sw} />
          <circle cx={item.w * 0.3} cy={item.h * 0.32} r={Math.min(item.w, item.h) * 0.14} className="plan-furn-stroke" fill="none" strokeWidth={sw} />
          <circle cx={item.w * 0.7} cy={item.h * 0.32} r={Math.min(item.w, item.h) * 0.14} className="plan-furn-stroke" fill="none" strokeWidth={sw} />
          <circle cx={item.w * 0.3} cy={item.h * 0.7} r={Math.min(item.w, item.h) * 0.14} className="plan-furn-stroke" fill="none" strokeWidth={sw} />
          <circle cx={item.w * 0.7} cy={item.h * 0.7} r={Math.min(item.w, item.h) * 0.14} className="plan-furn-stroke" fill="none" strokeWidth={sw} />
        </>
      )}
      {kind === "sink" && (
        <>
          <rect x={0} y={0} width={item.w} height={item.h} rx={0.1} className="plan-furn-fill plan-furn-stroke" strokeWidth={sw} />
          <ellipse
            cx={cx}
            cy={cy}
            rx={item.w * 0.32}
            ry={item.h * 0.28}
            className="plan-furn-stroke"
            fill="none"
            strokeWidth={sw}
          />
        </>
      )}
      {kind === "toilet" && (
        <>
          <rect x={item.w * 0.15} y={0} width={item.w * 0.7} height={item.h * 0.32} rx={0.08} className="plan-furn-fill plan-furn-stroke" strokeWidth={sw} />
          <ellipse
            cx={cx}
            cy={item.h * 0.62}
            rx={item.w * 0.38}
            ry={item.h * 0.32}
            className="plan-furn-fill plan-furn-stroke"
            strokeWidth={sw}
          />
        </>
      )}
      {kind === "shower" && (
        <>
          <rect x={0} y={0} width={item.w} height={item.h} rx={0.08} className="plan-furn-fill plan-furn-stroke" strokeWidth={sw} />
          <line x1={0} y1={0} x2={item.w} y2={item.h} className="plan-furn-stroke" strokeWidth={sw} />
          <line x1={item.w} y1={0} x2={0} y2={item.h} className="plan-furn-stroke" strokeWidth={sw} />
        </>
      )}
      {kind === "bathtub" && (
        <rect x={0} y={0} width={item.w} height={item.h} rx={Math.min(item.w, item.h) * 0.35} className="plan-furn-fill plan-furn-stroke" strokeWidth={sw} />
      )}
      {kind === "tv" && (
        <rect x={0} y={0} width={item.w} height={item.h} rx={0.06} className="plan-furn-fill plan-furn-stroke" strokeWidth={sw} />
      )}
      {kind === "wardrobe" && (
        <>
          <rect x={0} y={0} width={item.w} height={item.h} rx={0.08} className="plan-furn-fill plan-furn-stroke" strokeWidth={sw} />
          <line x1={item.w / 2} y1={0} x2={item.w / 2} y2={item.h} className="plan-furn-stroke" strokeWidth={sw} />
        </>
      )}
      {kind === "plant" && (
        <>
          <circle cx={cx} cy={cy} r={Math.min(item.w, item.h) / 2} className="plan-furn-fill plan-furn-stroke" strokeWidth={sw} />
          <circle cx={cx} cy={cy} r={Math.min(item.w, item.h) / 4} className="plan-furn-stroke" fill="none" strokeWidth={sw} />
        </>
      )}
      {kind === "nightstand" && (
        <rect x={0} y={0} width={item.w} height={item.h} rx={0.1} className="plan-furn-fill plan-furn-stroke" strokeWidth={sw} />
      )}
      {kind === "desk" && (
        <rect x={0} y={0} width={item.w} height={item.h} rx={0.08} className="plan-furn-fill plan-furn-stroke" strokeWidth={sw} />
      )}
      {kind === "chair" && (
        <rect x={0} y={0} width={item.w} height={item.h} rx={0.16} className="plan-furn-fill plan-furn-stroke" strokeWidth={sw} />
      )}
      {kind === "block" && (
        <rect x={0} y={0} width={item.w} height={item.h} rx={0.1} className="plan-furn-fill plan-furn-stroke" strokeWidth={sw} />
      )}
    </g>
  );
}

function NorthArrow({ x, y, size, angle }: { x: number; y: number; size: number; angle: number }) {
  const s = size;
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`} className="plan-ink">
      <polygon points={`0,${-s} ${s * 0.28},${s * 0.18} 0,${s * 0.04} ${-s * 0.28},${s * 0.18}`} className="plan-ink-fill" />
      <text
        y={s * 0.55}
        textAnchor="middle"
        fontSize={s * 0.38}
        className="plan-label-font plan-ink-fill"
        style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
      >
        N
      </text>
    </g>
  );
}

function ScaleBar({ x, y, units, width }: { x: number; y: number; units: FloorPlan["units"]; width: number }) {
  const major = scaleMajor(units, width);
  const len = major;
  return (
    <g className="plan-ink" transform={`translate(${x} ${y})`}>
      <line x1={0} y1={0} x2={len} y2={0} strokeWidth={0.08} />
      <line x1={0} y1={-0.22} x2={0} y2={0.22} strokeWidth={0.08} />
      <line x1={len / 2} y1={-0.14} x2={len / 2} y2={0.14} strokeWidth={0.06} />
      <line x1={len} y1={-0.22} x2={len} y2={0.22} strokeWidth={0.08} />
      <text
        x={0}
        y={0.7}
        fontSize={0.48}
        className="plan-label-font plan-ink-fill"
        style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
      >
        0
      </text>
      <text
        x={len}
        y={0.7}
        textAnchor="end"
        fontSize={0.48}
        className="plan-label-font plan-ink-fill"
        style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
      >
        {formatLength(major, units)}
      </text>
    </g>
  );
}

export function PlanSheet({
  plan,
  style,
  layers,
  selectedRoomId,
  selectedFurnitureId,
  onSelectRoom,
  onSelectFurniture,
  interactive = true,
  compact = false,
  sketching = false,
}: Props) {
  const layout = sheetLayout(plan);
  const roomsById = new Map(plan.rooms.map((room) => [room.id, room]));
  const font = "IBM Plex Sans, sans-serif";
  const serif = "Instrument Serif, Times New Roman, serif";
  const major = scaleMajor(plan.units, layout.bounds.w);

  return (
    <g className={`plan-root theme-${style}${sketching ? " is-sketching" : ""}`}>
      {style === "sketch" && (
        <filter id={`sketch-wobble-${plan.id}`} x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="0.06" />
        </filter>
      )}
      <rect
        x={layout.x}
        y={layout.y}
        width={layout.w}
        height={layout.h}
        className="plan-paper"
        rx={0.12}
      />
      <rect
        x={layout.x + 0.18}
        y={layout.y + 0.18}
        width={layout.w - 0.36}
        height={layout.h - 0.36}
        fill="none"
        className="plan-frame"
        rx={0.06}
      />

      {layers.grid && (
        <g className="plan-grid">
          {Array.from({ length: Math.ceil(layout.bounds.w) + 1 }, (_, i) => {
            const x = layout.bounds.minX + i;
            return (
              <line
                key={`vx-${i}`}
                x1={x}
                y1={layout.bounds.minY}
                x2={x}
                y2={layout.bounds.maxY}
                strokeWidth={i % 5 === 0 ? 0.035 : 0.018}
              />
            );
          })}
          {Array.from({ length: Math.ceil(layout.bounds.h) + 1 }, (_, i) => {
            const y = layout.bounds.minY + i;
            return (
              <line
                key={`hy-${i}`}
                x1={layout.bounds.minX}
                y1={y}
                x2={layout.bounds.maxX}
                y2={y}
                strokeWidth={i % 5 === 0 ? 0.035 : 0.018}
              />
            );
          })}
        </g>
      )}

      {plan.rooms.map((room, index) => {
        const selected = selectedRoomId === room.id;
        return (
          <g key={room.id} style={{ ["--sketch-i" as string]: index }}>
            <rect
              x={room.x}
              y={room.y}
              width={room.w}
              height={room.h}
              fill={roomFill(room.type)}
              className={selected ? "plan-room-selected" : "plan-room"}
              onClick={
                interactive
                  ? (event) => {
                      event.stopPropagation();
                      onSelectRoom?.(room.id);
                    }
                  : undefined
              }
              style={interactive ? { cursor: "pointer" } : undefined}
            />
          </g>
        );
      })}

      {plan.rooms.map((room, index) => (
        <rect
          key={`wall-${room.id}`}
          x={room.x}
          y={room.y}
          width={room.w}
          height={room.h}
          fill="none"
          className="plan-wall"
          pathLength={1}
          pointerEvents="none"
          style={{ ["--sketch-i" as string]: index }}
          filter={style === "sketch" ? `url(#sketch-wobble-${plan.id})` : undefined}
        />
      ))}

      {layers.openings &&
        (plan.openings ?? []).map((opening) => {
          const room = roomsById.get(opening.roomId);
          if (!room) return null;
          if (opening.kind === "window") {
            return <WindowSymbol key={opening.id} room={room} opening={opening} />;
          }
          return <DoorSymbol key={opening.id} room={room} opening={opening} />;
        })}

      {layers.furniture &&
        (plan.furniture ?? []).map((item) => (
          <g
            key={item.id}
            data-furn={item.id}
            onClick={
              interactive
                ? (event) => {
                    event.stopPropagation();
                    onSelectFurniture?.(item.id);
                  }
                : undefined
            }
            className={selectedFurnitureId === item.id ? "plan-furn-selected plan-furniture" : "plan-furniture"}
            style={interactive ? { cursor: "pointer" } : undefined}
          >
            <FurnitureSymbol item={item} />
          </g>
        ))}

      {layers.labels &&
        plan.rooms.map((room) => {
          const fs = Math.min(1.05, Math.max(0.55, Math.min(room.w, room.h) * 0.12));
          const showDim = layers.dimensions && room.w > 4 && room.h > 3.5;
          return (
            <g key={`label-${room.id}`} pointerEvents="none">
              <text
                x={room.x + room.w / 2}
                y={room.y + room.h / 2 - (showDim ? fs * 0.35 : 0)}
                textAnchor="middle"
                fontSize={fs}
                className="plan-room-label plan-ink-fill"
                style={{ fontFamily: serif, fontStyle: "italic" }}
              >
                {room.name}
              </text>
              {showDim && (
                <text
                  x={room.x + room.w / 2}
                  y={room.y + room.h / 2 + fs * 0.85}
                  textAnchor="middle"
                  fontSize={fs * 0.55}
                  className="plan-dim plan-ink-fill"
                  style={{ fontFamily: font }}
                >
                  {formatLength(room.w, plan.units)} × {formatLength(room.h, plan.units)}
                </text>
              )}
            </g>
          );
        })}

      {layers.dimensions && !compact && (
        <g className="plan-dim plan-ink" pointerEvents="none">
          <line
            x1={layout.bounds.minX}
            y1={layout.bounds.minY - 1.15}
            x2={layout.bounds.maxX}
            y2={layout.bounds.minY - 1.15}
            strokeWidth={0.045}
          />
          <line
            x1={layout.bounds.minX}
            y1={layout.bounds.minY - 1.35}
            x2={layout.bounds.minX}
            y2={layout.bounds.minY - 0.95}
            strokeWidth={0.045}
          />
          <line
            x1={layout.bounds.maxX}
            y1={layout.bounds.minY - 1.35}
            x2={layout.bounds.maxX}
            y2={layout.bounds.minY - 0.95}
            strokeWidth={0.045}
          />
          <text
            x={(layout.bounds.minX + layout.bounds.maxX) / 2}
            y={layout.bounds.minY - 1.4}
            textAnchor="middle"
            fontSize={0.55}
            className="plan-ink-fill"
            style={{ fontFamily: font }}
          >
            {formatLength(layout.bounds.w, plan.units)}
          </text>
          <line
            x1={layout.bounds.minX - 1.15}
            y1={layout.bounds.minY}
            x2={layout.bounds.minX - 1.15}
            y2={layout.bounds.maxY}
            strokeWidth={0.045}
          />
          <line
            x1={layout.bounds.minX - 1.35}
            y1={layout.bounds.minY}
            x2={layout.bounds.minX - 0.95}
            y2={layout.bounds.minY}
            strokeWidth={0.045}
          />
          <line
            x1={layout.bounds.minX - 1.35}
            y1={layout.bounds.maxY}
            x2={layout.bounds.minX - 0.95}
            y2={layout.bounds.maxY}
            strokeWidth={0.045}
          />
          <text
            x={layout.bounds.minX - 1.4}
            y={(layout.bounds.minY + layout.bounds.maxY) / 2}
            textAnchor="middle"
            fontSize={0.55}
            className="plan-ink-fill"
            transform={`rotate(-90 ${layout.bounds.minX - 1.4} ${(layout.bounds.minY + layout.bounds.maxY) / 2})`}
            style={{ fontFamily: font }}
          >
            {formatLength(layout.bounds.h, plan.units)}
          </text>
        </g>
      )}

      {!compact && (
        <g>
          <line
            x1={layout.x + 0.45}
            y1={layout.titleY}
            x2={layout.x + layout.w - 0.45}
            y2={layout.titleY}
            className="plan-frame"
            strokeWidth={0.04}
          />
          <text
            x={layout.x + 0.7}
            y={layout.titleY + 1.05}
            fontSize={0.95}
            className="plan-ink-fill"
            style={{ fontFamily: serif }}
          >
            {plan.title}
          </text>
          <text
            x={layout.x + 0.7}
            y={layout.titleY + 1.7}
            fontSize={0.42}
            className="plan-muted-fill"
            style={{ fontFamily: font }}
          >
            {sourceCaption(plan)} · {formatLength(layout.bounds.w, plan.units)} × {formatLength(layout.bounds.h, plan.units)} ·{" "}
            {formatArea(layout.bounds.w, layout.bounds.h, plan.units)}
          </text>
          {siteCaption(plan) && (
            <text
              x={layout.x + 0.7}
              y={layout.titleY + 2.22}
              fontSize={0.38}
              className="plan-muted-fill"
              style={{ fontFamily: font }}
            >
              {siteCaption(plan)}
            </text>
          )}
          <ScaleBar
            x={layout.x + layout.w - major - 3.4}
            y={layout.titleY + 1.15}
            units={plan.units}
            width={layout.bounds.w}
          />
          <NorthArrow
            x={layout.x + layout.w - 1.7}
            y={layout.titleY + 1.2}
            size={0.7}
            angle={plan.northAngle}
          />
        </g>
      )}
    </g>
  );
}

