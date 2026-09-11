import { uid } from "./format";
import type {
  DoorSwing,
  FloorPlan,
  Furniture,
  Opening,
  OpeningKind,
  Room,
  RoomType,
  SourceKind,
  Units,
  WallSide,
} from "./types";
import { ROOM_TYPES } from "./types";

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

export function extractJsonObject(text: string): unknown {
  const stripped = text.replace(/```json|```/gi, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("The model did not return a plan.");
  }
  return JSON.parse(stripped.slice(start, end + 1));
}

export function normalizePlan(
  raw: unknown,
  meta: { sourceKind: SourceKind; sourceCount: number; units: Units },
): FloorPlan {
  if (!raw || typeof raw !== "object") {
    throw new Error("The model returned an empty plan.");
  }
  const data = raw as Record<string, unknown>;
  const roomsRaw = Array.isArray(data.rooms) ? data.rooms : [];
  const rooms: Room[] = [];
  for (const entry of roomsRaw.slice(0, 24)) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    const w = Math.abs(num(r.w, num(r.width, 0)));
    const h = Math.abs(num(r.h, num(r.depth, num(r.height, 0))));
    if (w < 1 || h < 1) continue;
    rooms.push({
      id: str(r.id, uid("room")),
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

  const ids = new Set(rooms.map((room) => room.id));
  const openings: Opening[] = [];
  const openingsRaw = Array.isArray(data.openings) ? data.openings : [];
  for (const entry of openingsRaw.slice(0, 48)) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const roomId = str(o.roomId, str(o.room_id));
    if (!ids.has(roomId)) continue;
    const width = Math.abs(num(o.width, 2.5));
    if (width < 0.6) continue;
    const kind = asOpeningKind(o.kind);
    openings.push({
      id: str(o.id, uid("open")),
      kind,
      roomId,
      wall: asWall(o.wall),
      offset: Math.max(0, num(o.offset)),
      width,
      swing: asSwing(o.swing, kind),
    });
  }

  const furniture: Furniture[] = [];
  const furnitureRaw = Array.isArray(data.furniture) ? data.furniture : [];
  for (const entry of furnitureRaw.slice(0, 48)) {
    if (!entry || typeof entry !== "object") continue;
    const f = entry as Record<string, unknown>;
    const w = Math.abs(num(f.w, num(f.width, 0)));
    const h = Math.abs(num(f.h, num(f.depth, 0)));
    if (w < 0.4 || h < 0.4) continue;
    furniture.push({
      id: str(f.id, uid("furn")),
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

  const units = asUnits(data.units, meta.units);
  const overallWidth = Math.max(maxX, Math.abs(num(data.overallWidth, maxX)));
  const overallDepth = Math.max(maxY, Math.abs(num(data.overallDepth, maxY)));
  const confidence = Math.min(1, Math.max(0, num(data.confidence, 0.55)));

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
  };
}
