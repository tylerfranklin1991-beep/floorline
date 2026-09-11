export type Units = "ft" | "m";

export type RoomType =
  | "living"
  | "kitchen"
  | "dining"
  | "bedroom"
  | "bath"
  | "hallway"
  | "closet"
  | "office"
  | "laundry"
  | "garage"
  | "outdoor"
  | "other";

export type WallSide = "n" | "s" | "e" | "w";

export type OpeningKind = "door" | "window" | "opening" | "sliding";

export type DoorSwing = "in-left" | "in-right" | "out-left" | "out-right" | "none";

export type PlanStyle = "sheet" | "blueprint" | "ink" | "sketch";

export type SourceKind = "photos" | "video" | "mixed" | "sample";

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Opening {
  id: string;
  kind: OpeningKind;
  roomId: string;
  wall: WallSide;
  offset: number;
  width: number;
  swing: DoorSwing;
}

export interface Furniture {
  id: string;
  kind: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export interface SiteFix {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  altitude: number | null;
  address: string | null;
  capturedAt: number;
}

export interface HeadingSample {
  at: number;
  heading: number;
  label: string;
  spaceId: string;
}

export interface SurveySite {
  fix: SiteFix | null;
  headings: HeadingSample[];
  track: { lat: number; lng: number }[];
}

export interface FloorPlan {
  id: string;
  title: string;
  createdAt: number;
  units: Units;
  overallWidth: number;
  overallDepth: number;
  northAngle: number;
  rooms: Room[];
  openings: Opening[];
  furniture: Furniture[];
  notes: string;
  sourceKind: SourceKind;
  sourceCount: number;
  confidence: number;
  site?: SiteFix | null;
  headings?: HeadingSample[];
  track?: { lat: number; lng: number }[];
}

export interface PlanLayers {
  grid: boolean;
  labels: boolean;
  dimensions: boolean;
  furniture: boolean;
  openings: boolean;
}

export const DEFAULT_LAYERS: PlanLayers = {
  grid: true,
  labels: true,
  dimensions: true,
  furniture: true,
  openings: true,
};

export const ROOM_TYPES: RoomType[] = [
  "living",
  "kitchen",
  "dining",
  "bedroom",
  "bath",
  "hallway",
  "closet",
  "office",
  "laundry",
  "garage",
  "outdoor",
  "other",
];
