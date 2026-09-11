import type { CoachAdvice } from "./coach";
import type { LiveMetrics } from "./live-scan";

export type GuideSpaceId =
  | "entry"
  | "living"
  | "kitchen"
  | "dining"
  | "bedroom"
  | "bath"
  | "hall"
  | "office"
  | "outdoor";

export type GuideNeed = "door" | "window" | "floor" | "wall-corner" | "opening" | "fixtures" | "furniture";

export type GuideSpace = {
  id: GuideSpaceId;
  label: string;
  typical: boolean;
};

export const GUIDE_SPACES: GuideSpace[] = [
  { id: "entry", label: "Entry", typical: true },
  { id: "living", label: "Living", typical: true },
  { id: "kitchen", label: "Kitchen", typical: true },
  { id: "dining", label: "Dining", typical: false },
  { id: "bedroom", label: "Bedroom", typical: true },
  { id: "bath", label: "Bath", typical: true },
  { id: "hall", label: "Hall", typical: false },
  { id: "office", label: "Office", typical: false },
  { id: "outdoor", label: "Outdoor", typical: false },
];

export const TYPICAL_SPACE_IDS: GuideSpaceId[] = GUIDE_SPACES.filter((space) => space.typical).map(
  (space) => space.id,
);

export type GuideCue = {
  id: string;
  spaceId: GuideSpaceId | "technique";
  title: string;
  body: string;
  holdSeconds: number;
  needs: GuideNeed[];
};

const ROOM_CUES: Record<GuideSpaceId, Omit<GuideCue, "id" | "spaceId">> = {
  entry: {
    title: "Front door",
    body: "Stand in the doorway and point the camera at the door. Include a little of the floor.",
    holdSeconds: 6,
    needs: ["door", "floor"],
  },
  living: {
    title: "Living room",
    body: "Stand in a corner and slowly turn so we can see the whole room.",
    holdSeconds: 7,
    needs: ["wall-corner", "floor", "furniture"],
  },
  kitchen: {
    title: "Kitchen",
    body: "From the doorway, show the counters, the sink, and the stove.",
    holdSeconds: 7,
    needs: ["fixtures", "floor"],
  },
  dining: {
    title: "Dining",
    body: "Show the table, then the opening into the next room.",
    holdSeconds: 6,
    needs: ["furniture", "opening"],
  },
  bedroom: {
    title: "Bedroom",
    body: "From the door, show the bed, then the window.",
    holdSeconds: 6,
    needs: ["furniture", "window"],
  },
  bath: {
    title: "Bathroom",
    body: "Stand in the doorway and fit the sink, toilet, and shower in the picture.",
    holdSeconds: 6,
    needs: ["fixtures", "door"],
  },
  hall: {
    title: "Hallway",
    body: "Walk the hall slowly and pause at each door.",
    holdSeconds: 6,
    needs: ["door", "opening"],
  },
  office: {
    title: "Office",
    body: "From the door, show the desk and the window.",
    holdSeconds: 6,
    needs: ["furniture", "window"],
  },
  outdoor: {
    title: "Outside",
    body: "Step to the back door, show the outside, then turn back inside.",
    holdSeconds: 6,
    needs: ["door", "opening"],
  },
};

export function buildGuideCues(spaceIds: GuideSpaceId[]): GuideCue[] {
  const selected = spaceIds.length > 0 ? spaceIds : TYPICAL_SPACE_IDS;
  const cues: GuideCue[] = [];

  if (!selected.includes("entry")) {
    cues.push({
      id: "start",
      spaceId: "technique",
      title: "Front door",
      body: "Hold the phone on your front door for a moment, then walk inside.",
      holdSeconds: 5,
      needs: ["door"],
    });
  }

  for (const id of selected) {
    const room = ROOM_CUES[id];
    cues.push({
      id: `room-${id}`,
      spaceId: id,
      title: room.title,
      body: room.body,
      holdSeconds: room.holdSeconds,
      needs: room.needs,
    });
  }

  cues.push(
    {
      id: "doors",
      spaceId: "technique",
      title: "Doorways",
      body: "Pause in a doorway and look through, so both rooms are in the picture.",
      holdSeconds: 6,
      needs: ["door", "opening"],
    },
    {
      id: "spin",
      spaceId: "technique",
      title: "Slow turn",
      body: "Stand in the main room and turn a full circle. Keep the floor in view.",
      holdSeconds: 7,
      needs: ["wall-corner", "floor"],
    },
  );

  return cues;
}

export function needLabel(need: GuideNeed): string {
  if (need === "wall-corner") return "Two walls";
  if (need === "opening") return "Next room";
  if (need === "fixtures") return "Sink & stove";
  if (need === "furniture") return "Furniture";
  if (need === "window") return "Window";
  if (need === "floor") return "Floor";
  return "Door";
}

const SAMPLE_SEEN: Record<string, string[]> = {
  Living: ["furniture", "floor", "wall-corner", "window", "opening"],
  Kitchen: ["kitchen-run", "sink", "hob", "island", "floor", "opening"],
  Bedroom: ["bed", "furniture", "window", "floor", "door"],
  Bath: ["bath-fixtures", "door", "floor"],
};

export function sampleIndexForCue(cue: GuideCue): number {
  if (cue.spaceId === "kitchen") return 1;
  if (cue.spaceId === "bedroom") return 2;
  if (cue.spaceId === "bath") return 3;
  return 0;
}

export function localCoach(args: {
  cue: GuideCue;
  metrics: LiveMetrics;
  sampleLabel?: string;
}): CoachAdvice {
  const { cue, metrics, sampleLabel } = args;
  if (metrics.tooFast || metrics.dark || metrics.tiltDown) {
    return {
      room: sampleLabel?.toLowerCase() ?? "unknown",
      seen: [],
      missing: cue.needs,
      instruction: metrics.prompt,
      pass: false,
      quality: 0.2,
    };
  }

  if (sampleLabel && SAMPLE_SEEN[sampleLabel]) {
    const seen = SAMPLE_SEEN[sampleLabel];
    const room = sampleLabel.toLowerCase();
    const sameRoom =
      cue.spaceId === room ||
      (cue.spaceId === "entry" && sampleLabel === "Living") ||
      cue.spaceId === "technique";
    const covered = cue.needs.filter((need) => needMet(need, seen)).length;
    const pass = sameRoom && covered >= Math.max(1, Math.ceil(cue.needs.length * 0.66));

    if (!sameRoom) {
      const want = GUIDE_SPACES.find((space) => space.id === cue.spaceId)?.label ?? cue.title;
      return {
        room,
        seen,
        missing: cue.needs,
        instruction: `This looks like the ${room}. Walk over to the ${want.toLowerCase()}.`,
        pass: false,
        quality: 0.45,
      };
    }

    const instructions: Record<string, string> = {
      start: pass ? "That's the door. Hold still, then walk inside." : "Point the camera at your front door.",
      entry: pass ? "Nice. Hold still, then turn to show where it opens." : "Show the door and a little of the floor.",
      living: pass ? "We've got the living room. Hold still, then turn slowly." : "Stand in a corner and show two walls.",
      kitchen: pass ? "Kitchen looks good. Hold on the sink for a second." : "Show the counters, sink, and stove.",
      dining: pass ? "That's the dining space. Hold still." : "Show the table and the opening next to it.",
      bedroom: pass ? "Bedroom is in. Hold still, then include the window." : "Show the bed, then the window.",
      bath: pass ? "Bathroom is in. Hold still in the doorway." : "Fit the sink, toilet, and shower in the picture.",
      hall: pass ? "Hallway is in. Pause at the next door." : "Walk the hall slowly and pause at each door.",
      office: pass ? "Office is in. Hold still." : "Show the desk and the window.",
      outdoor: pass ? "Outside is in. Turn back toward the house." : "Show the outside, then turn back inside.",
      doors: pass ? "We can see both rooms. Hold still." : "Stand in a doorway and look through.",
      spin: pass ? "Nice and slow. Finish the circle, then we're done." : "Turn slowly and keep the floor in the picture.",
    };
    const key = cue.spaceId === "technique" ? cue.id : cue.spaceId;
    return {
      room,
      seen,
      missing: cue.needs.filter((need) => !needMet(need, seen)),
      instruction: instructions[key] ?? cue.body,
      pass,
      quality: pass ? 0.8 : 0.5,
    };
  }

  return {
    room: "unknown",
    seen: [],
    missing: cue.needs,
    instruction: cue.body,
    pass: false,
    quality: metrics.stable ? 0.4 : 0.3,
  };
}

export function needMet(need: GuideNeed, seen: string[]): boolean {
  if (need === "fixtures") {
    return seen.some((item) => ["sink", "hob", "kitchen-run", "bath-fixtures", "island"].includes(item));
  }
  if (need === "furniture") return seen.some((item) => ["furniture", "bed", "island"].includes(item));
  if (need === "wall-corner") return seen.includes("wall-corner");
  if (need === "opening") return seen.includes("opening") || seen.includes("door");
  return seen.includes(need);
}

export function buildGuideHint(
  spaceIds: GuideSpaceId[],
  capturedTitles: string[],
  seen: string[],
): string {
  const labels = (spaceIds.length > 0 ? spaceIds : TYPICAL_SPACE_IDS)
    .map((id) => GUIDE_SPACES.find((space) => space.id === id)?.label ?? id)
    .join(", ");
  const keys = capturedTitles.slice(0, 6).join("; ");
  const evidence = Array.from(new Set(seen)).slice(0, 8).join(", ");
  const text = [
    `Guided walkthrough of a single storey covering: ${labels}.`,
    keys ? `Locked shots: ${keys}.` : "",
    evidence ? `Evidence in frames: ${evidence}.` : "",
    "Reconstruct rooms in that sequence from the entry, sharing walls, with doors at the filmed connections.",
    "Infer scale from door widths and typical room sizes. Include visible furniture.",
  ]
    .filter(Boolean)
    .join(" ");
  return text.slice(0, 600);
}

export const MAX_GUIDED_RECORD_S = 90;
export const HOLD_LOCK_MS = 2400;
