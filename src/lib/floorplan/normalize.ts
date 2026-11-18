import { uid } from "./format.ts";
import type {
  DoorSwing,
  FloorPlan,
  Furniture,
  MeasurementBasis,
  Opening,
  OpeningKind,
  Room,
  RoomType,
  ScaleReference,
  SourceKind,
  Units,
  WallSide,
} from "./types.ts";
import { ROOM_TYPES } from "./types.ts";

const ROOM_SET = new Set<string>(ROOM_TYPES);
const WALLS = new Set<WallSide>(["n", "s", "e", "w"]);
const OPENING_KINDS = new Set<OpeningKind>(["door", "window", "opening", "sliding"]);
const SWINGS = new Set<DoorSwing>(["in-left", "in-right", "out-left", "out-right", "none"]);

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asRoomType(value: unknown): RoomType {
  const raw = str(value, "other").toLowerCase();
  if (ROOM_SET.has(raw)) return raw as RoomType;
  if (raw.includes("bed")) return "bedroom";
  if (raw.includes("bath") || raw.includes("wc") || raw.includes("toilet")) return "bath";
  if (raw.includes("kit")) return "kitchen";
  if (raw.includes("din")) return "dining";
  if (raw.includes("liv") || raw.includes("lounge") || raw.includes("great")) return "living";
  if (raw.includes("hall") || raw.includes("corridor") || raw.includes("entry") || raw.includes("foyer"))
    return "hallway";
  if (raw.includes("clos") || raw.includes("wardrobe") || raw.includes("pantry")) return "closet";
  if (raw.includes("office") || raw.includes("study") || raw.includes("den")) return "office";
  if (raw.includes("laund") || raw.includes("utility")) return "laundry";
  if (raw.includes("garag")) return "garage";
  if (raw.includes("patio") || raw.includes("balcony") || raw.includes("deck") || raw.includes("yard"))
    return "outdoor";
  return "other";
}

function asWall(value: unknown): WallSide {
  const raw = str(value, "n").toLowerCase();
  if (WALLS.has(raw as WallSide)) return raw as WallSide;
  if (raw.startsWith("north") || raw === "top") return "n";
  if (raw.startsWith("south") || raw === "bottom") return "s";
  if (raw.startsWith("east") || raw === "right") return "e";
  if (raw.startsWith("west") || raw === "left") return "w";
  return "n";
}

function asOpeningKind(value: unknown): OpeningKind {
  const raw = str(value, "door").toLowerCase();
  if (OPENING_KINDS.has(raw as OpeningKind)) return raw as OpeningKind;
  if (raw.includes("window")) return "window";
  if (raw.includes("slid")) return "sliding";
  if (raw.includes("open") || raw.includes("arch") || raw.includes("cased")) return "opening";
  return "door";
}

function asSwing(value: unknown, kind: OpeningKind): DoorSwing {
  if (kind !== "door") return "none";
  const raw = str(value, "in-left").toLowerCase();
  if (SWINGS.has(raw as DoorSwing)) return raw as DoorSwing;
  return "in-left";
}

function asUnits(value: unknown, fallback: Units): Units {
  const raw = str(value, fallback).toLowerCase();
  return raw === "m" || raw === "meters" || raw === "metres" ? "m" : "ft";
}

/**
 * Size thresholds are defined in metres and converted to plan units, so a
 * 0.9 m closet is not dropped in metric mode while a 1 ft sliver is kept.
 * (Previously the same raw numbers were compared in both ft and m.)
 */
const FT_PER_METER = 1 / 0.3048;
function inPlanUnits(meters: number, units: Units): number {
  return units === "m" ? meters : meters * FT_PER_METER;
}
const MIN_ROOM_M = 0.9;
const MIN_OPENING_M = 0.6;
const MIN_FURNITURE_M = 0.4;
const DEFAULT_OPENING_M = 0.8; // ~2.5 ft
const DEFAULT_CONFIDENCE = 0.55;

export interface NormalizeMeta {
  sourceKind: SourceKind;
  sourceCount: number;
  units: Units;
  /** Laser scale anchor used at trace time; makes the plan "measured". */
  scaleReference?: ScaleReference | null;
  /** Rough GPS walk span, used only as a footprint sanity check. */
  gpsSpan?: { widthM: number; depthM: number } | null;
}

function overlapFraction(a: Room, b: Room): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.w * a.h, b.w * b.h);
}

function wallLength(room: Room, wall: WallSide): number {
  return wall === "n" || wall === "s" ? room.w : room.h;
}

export function extractJsonObject(text: string): unknown {
  const stripped = text.replace(/```json|```/gi, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("The model did not return a plan.");
  }
  return JSON.parse(stripped.slice(start, end + 1));
}

export function normalizePlan(raw: unknown, meta: NormalizeMeta): FloorPlan {
  if (!raw || typeof raw !== "object") {
    throw new Error("The model returned an empty plan.");
  }
  const data = raw as Record<string, unknown>;
  // Units first: every size threshold below is converted from metres.
  const units = asUnits(data.units, meta.units);
  const minRoom = inPlanUnits(MIN_ROOM_M, units);
  const minOpening = inPlanUnits(MIN_OPENING_M, units);
  const minFurniture = inPlanUnits(MIN_FURNITURE_M, units);
  const defaultOpeningWidth = inPlanUnits(DEFAULT_OPENING_M, units);
  const warnings: string[] = [];

  const roomsRaw = Array.isArray(data.rooms) ? data.rooms : [];
  const rooms: Room[] = [];
  const seenRoomIds = new Set<string>();
  for (const entry of roomsRaw.slice(0, 24)) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    const w = Math.abs(num(r.w, num(r.width, 0)));
    const h = Math.abs(num(r.h, num(r.depth, num(r.height, 0))));
    if (w < minRoom || h < minRoom) continue;
    let id = str(r.id, uid("room"));
    if (seenRoomIds.has(id)) {
      warnings.push(`Duplicate room id "${id}" was renamed.`);
      id = uid("room");
    }
    seenRoomIds.add(id);
    rooms.push({
      id,
      name: str(r.name, asRoomType(r.type)),
      type: asRoomType(r.type),
      x: num(r.x),
      y: num(r.y),
      w,
      h,
    });
  }
  if (rooms.length === 0) {
    throw new Error("No rooms could be traced from those frames.");
  }

  // Geometric validation: rooms must not overlap. We warn instead of
  // dropping rooms, so a bad model plan stays visible (and fixable).
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const fraction = overlapFraction(rooms[i], rooms[j]);
      if (fraction > 0.05) {
        warnings.push(
          `Rooms "${rooms[i].name}" and "${rooms[j].name}" overlap by about ${Math.round(fraction * 100)}% of the smaller room.`,
        );
      }
    }
  }

  const ids = new Set(rooms.map((room) => room.id));
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const openings: Opening[] = [];
  const openingsRaw = Array.isArray(data.openings) ? data.openings : [];
  const seenOpeningIds = new Set<string>();
  for (const entry of openingsRaw.slice(0, 48)) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const roomId = str(o.roomId, str(o.room_id));
    if (!ids.has(roomId)) continue;
    let width = Math.abs(num(o.width, defaultOpeningWidth));
    if (width < minOpening) continue;
    const kind = asOpeningKind(o.kind);
    const wall = asWall(o.wall);
    const room = roomById.get(roomId);
    const length = room ? wallLength(room, wall) : 0;
    let offset = Math.max(0, num(o.offset));
    if (num(o.offset) < 0) {
      warnings.push(`Opening in "${room?.name ?? roomId}" had a negative offset; moved to the wall start.`);
    }
    if (length > 0 && width > length) {
      warnings.push(
        `Opening in "${room?.name ?? roomId}" is wider than its ${wall} wall; clamped to the wall.`,
      );
      width = length;
    } else if (length > 0 && offset + width > length) {
      warnings.push(
        `Opening in "${room?.name ?? roomId}" extended past its ${wall} wall; moved to fit.`,
      );
      offset = Math.max(0, length - width);
    }
    let id = str(o.id, uid("open"));
    if (seenOpeningIds.has(id)) {
      warnings.push(`Duplicate opening id "${id}" was renamed.`);
      id = uid("open");
    }
    seenOpeningIds.add(id);
    openings.push({
      id,
      kind,
      roomId,
      wall,
      offset,
      width,
      swing: asSwing(o.swing, kind),
    });
  }

  const furniture: Furniture[] = [];
  const furnitureRaw = Array.isArray(data.furniture) ? data.furniture : [];
  const seenFurnitureIds = new Set<string>();
  for (const entry of furnitureRaw.slice(0, 48)) {
    if (!entry || typeof entry !== "object") continue;
    const f = entry as Record<string, unknown>;
    const w = Math.abs(num(f.w, num(f.width, 0)));
    const h = Math.abs(num(f.h, num(f.depth, 0)));
    if (w < minFurniture || h < minFurniture) continue;
    let id = str(f.id, uid("furn"));
    if (seenFurnitureIds.has(id)) {
      warnings.push(`Duplicate furniture id "${id}" was renamed.`);
      id = uid("furn");
    }
    seenFurnitureIds.add(id);
    furniture.push({
      id,
      kind: str(f.kind, "block").toLowerCase(),
      label: str(f.label, str(f.kind, "Object")),
      x: num(f.x),
      y: num(f.y),
      w,
      h,
      rotation: num(f.rotation),
    });
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const room of rooms) {
    minX = Math.min(minX, room.x);
    minY = Math.min(minY, room.y);
    maxX = Math.max(maxX, room.x + room.w);
    maxY = Math.max(maxY, room.y + room.h);
  }
  if (minX !== 0 || minY !== 0) {
    for (const room of rooms) {
      room.x -= minX;
      room.y -= minY;
    }
    for (const item of furniture) {
      item.x -= minX;
      item.y -= minY;
    }
    maxX -= minX;
    maxY -= minY;
  }

  // Furniture must sit inside a room. Warn (don't drop) so a misplaced
  // block stays visible instead of silently disappearing from the sheet.
  // Checked after the origin shift above, so coordinates are final.
  for (const item of furniture) {
    const inside = rooms.some(
      (room) =>
        item.x >= room.x - 0.05 &&
        item.y >= room.y - 0.05 &&
        item.x + item.w <= room.x + room.w + 0.05 &&
        item.y + item.h <= room.y + room.h + 0.05,
    );
    if (!inside) {
      warnings.push(`Furniture "${item.label}" is not inside any room.`);
    }
  }

  const overallWidth = Math.max(maxX, Math.abs(num(data.overallWidth, maxX)));
  const overallDepth = Math.max(maxY, Math.abs(num(data.overallDepth, maxY)));

  // Footprint coverage: rooms should roughly fill the stated footprint.
  const roomArea = rooms.reduce((sum, room) => sum + room.w * room.h, 0);
  const footprintArea = overallWidth * overallDepth;
  if (footprintArea > 0 && roomArea < footprintArea * 0.5) {
    warnings.push(
      `Rooms cover only about ${Math.round((roomArea / footprintArea) * 100)}% of the stated footprint — some spaces may be missing.`,
    );
  } else if (footprintArea > 0 && roomArea > footprintArea * 1.1) {
    warnings.push("Rooms cover more than the stated footprint — dimensions may overlap.");
  }

  // GPS walk span is a rough footprint check only, never a room measurement.
  if (meta.gpsSpan) {
    const toMeters = (n: number) => (units === "m" ? n : n * 0.3048);
    const spanW = meta.gpsSpan.widthM;
    const spanD = meta.gpsSpan.depthM;
    const planW = toMeters(overallWidth);
    const planD = toMeters(overallDepth);
    const differs = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b) > 0.5;
    if (differs(planW, spanW) || differs(planD, spanD)) {
      warnings.push(
        `GPS walk span (about ${Math.round(spanW)}×${Math.round(spanD)} m) differs from the traced footprint (about ${Math.round(planW)}×${Math.round(planD)} m); dimensions are estimates.`,
      );
    }
  }

  // Confidence is the model's own self-report, not a measurement. When the
  // model reports none, say so instead of silently presenting a default.
  const confidenceProvided = typeof data.confidence === "number" && Number.isFinite(data.confidence);
  const confidence = confidenceProvided
    ? Math.min(1, Math.max(0, data.confidence as number))
    : DEFAULT_CONFIDENCE;
  if (!confidenceProvided) {
    warnings.push("The model reported no confidence; showing a 55% default estimate.");
  }

  const measurementBasis: MeasurementBasis =
    meta.scaleReference?.kind === "disto" ? "measured" : "estimated";

  return {
    id: uid("plan"),
    title: str(data.title, "Untitled sheet"),
    createdAt: Date.now(),
    units,
    overallWidth,
    overallDepth,
    northAngle: num(data.northAngle),
    rooms,
    openings,
    furniture,
    notes: str(data.notes),
    sourceKind: meta.sourceKind,
    sourceCount: meta.sourceCount,
    confidence,
    confidenceSource: confidenceProvided ? "model" : "default",
    measurementBasis,
    validationWarnings: warnings,
    scaleReference: meta.scaleReference ?? null,
  };
}
