import type { FloorPlan, Furniture, Room, RoomType, Units } from "./types";

export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

export function formatLength(n: number, units: Units): string {
  if (units === "m") {
    const rounded = Math.round(n * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded} m` : `${rounded.toFixed(1)} m`;
  }
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const feet = Math.floor(abs + 1e-6);
  const inches = Math.round((abs - feet) * 12);
  if (inches === 12) return `${sign}${feet + 1}'`;
  if (inches === 0) return `${sign}${feet}'`;
  return `${sign}${feet}'-${inches}"`;
}

export function formatArea(w: number, h: number, units: Units): string {
  const area = w * h;
  if (units === "m") {
    return `${Math.round(area)} m²`;
  }
  return `${Math.round(area)} sf`;
}

export function fromMeters(meters: number, units: Units): number {
  const n = units === "m" ? meters : meters / 0.3048;
  return Math.round(n * 100) / 100;
}

export function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

export function roomTypeLabel(type: RoomType): string {
  if (type === "bath") return "Bath";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function planBounds(plan: FloorPlan) {
  let minX = 0;
  let minY = 0;
  let maxX = plan.overallWidth;
  let maxY = plan.overallDepth;
  for (const room of plan.rooms ?? []) {
    minX = Math.min(minX, room.x);
    minY = Math.min(minY, room.y);
    maxX = Math.max(maxX, room.x + room.w);
    maxY = Math.max(maxY, room.y + room.h);
  }
  for (const item of plan.furniture ?? []) {
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + item.w);
    maxY = Math.max(maxY, item.y + item.h);
  }
  if (!Number.isFinite(minX) || maxX - minX < 4) {
    return { minX: 0, minY: 0, maxX: 20, maxY: 16, w: 20, h: 16 };
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function measureFootprint(rooms: Room[], furniture: Furniture[]) {
  let maxX = 0;
  let maxY = 0;
  for (const room of rooms) {
    maxX = Math.max(maxX, room.x + room.w);
    maxY = Math.max(maxY, room.y + room.h);
  }
  for (const item of furniture) {
    maxX = Math.max(maxX, item.x + item.w);
    maxY = Math.max(maxY, item.y + item.h);
  }
  return {
    overallWidth: Math.max(4, Math.round(maxX * 100) / 100),
    overallDepth: Math.max(4, Math.round(maxY * 100) / 100),
  };
}

export function convertPlan(plan: FloorPlan, units: Units): FloorPlan {
  if (plan.units === units) return plan;
  const factor = plan.units === "ft" ? 0.3048 : 1 / 0.3048;
  const scale = (n: number) => Math.round(n * factor * 100) / 100;
  const rooms = plan.rooms.map((room) => ({
    ...room,
    x: scale(room.x),
    y: scale(room.y),
    w: scale(room.w),
    h: scale(room.h),
  }));
  const furniture = (plan.furniture ?? []).map((item) => ({
    ...item,
    x: scale(item.x),
    y: scale(item.y),
    w: scale(item.w),
    h: scale(item.h),
  }));
  const openings = (plan.openings ?? []).map((opening) => ({
    ...opening,
    offset: scale(opening.offset),
    width: scale(opening.width),
  }));
  return {
    ...plan,
    units,
    rooms,
    furniture,
    openings,
    overallWidth: scale(plan.overallWidth),
    overallDepth: scale(plan.overallDepth),
  };
}

export function scaleMajor(units: Units, width: number): number {
  if (units === "m") {
    if (width >= 24) return 5;
    if (width >= 10) return 2;
    return 1;
  }
  if (width >= 50) return 10;
  if (width >= 20) return 5;
  return 2;
}

export function sheetLayout(plan: FloorPlan) {
  const bounds = planBounds(plan);
  const margin = 2.4;
  const title = 2.85;
  return {
    x: bounds.minX - margin,
    y: bounds.minY - margin,
    w: bounds.w + margin * 2,
    h: bounds.h + margin * 2 + title,
    bounds,
    titleY: bounds.maxY + 0.55,
  };
}

export function sourceCaption(plan: FloorPlan): string {
  if (plan.sourceKind === "sample") return "Sample sheet";
  if (plan.sourceKind === "video") return "From video";
  if (plan.sourceKind === "mixed") return "From survey";
  return plan.sourceCount === 1 ? "From 1 photo" : `From ${plan.sourceCount} photos`;
}

export function siteCaption(plan: FloorPlan): string | null {
  if (!plan.site) return null;
  return plan.site.address || `${plan.site.lat.toFixed(4)}, ${plan.site.lng.toFixed(4)}`;
}
