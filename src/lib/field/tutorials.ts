/**
 * How-to topics for the sketch screen.
 *
 * Media files live in `public/tutorials/<id>/` and are bundled with the app,
 * so the menu works offline. To use your own recording, replace the file and
 * keep the same name (1.webp, 2.webp, … and clip.mp4). Then set `imageKind`
 * or `videoKind` to "capture" if you want the placeholder note hidden.
 */

export type TutorialApp = "beta" | "beta2";

export type MediaKind = "capture" | "placeholder";

export const TUTORIAL_CATEGORIES = [
  "Getting started",
  "Drawing rooms",
  "Laser / DISTO",
  "Openings & closets",
  "Photos",
  "Estimates & PDF",
  "ARCore scan",
] as const;

export type TutorialCategory = (typeof TUTORIAL_CATEGORIES)[number];

export type TutorialStep = {
  title: string;
  body: string;
  /** Site path, e.g. /tutorials/laser/1.webp */
  image: string;
  imageKind: MediaKind;
};

export type Tutorial = {
  id: string;
  title: string;
  category: TutorialCategory;
  /** One line under the title in the list. */
  blurb: string;
  apps: TutorialApp[];
  steps: TutorialStep[];
  video?: string;
  videoKind?: MediaKind;
};

const CAPTURED_STEPS = new Set([
  "getting-started:1",
  "getting-started:2",
  "getting-started:3",
  "getting-started:4",
  "add-room:1",
  "add-room:2",
  "add-room:3",
  "add-room:4",
  "draw-room:1",
  "draw-room:2",
  "draw-room:3",
  "draw-room:4",
  "trace:1",
  "trace:2",
  "trace:3",
  "edit-walls:1",
  "edit-walls:2",
  "edit-walls:3",
  "edit-walls:4",
  "edit-walls:5",
  "laser:1",
  "laser:2",
  "laser:3",
  "laser:4",
  "laser:5",
  "draw-walls:1",
  "draw-walls:2",
  "draw-walls:3",
  "draw-walls:4",
  "draw-walls:5",
  "add-opening:1",
  "add-opening:2",
  "add-opening:3",
  "add-opening:4",
  "add-closet:1",
  "materials:1",
  "materials:2",
  "materials:3",
  "materials:4",
  "pdf:1",
  "pdf:2",
  "pdf:3",
  "pdf:4",
  "quote:1",
  "quote:2",
  "quote:3",
  "quote:4",
  "seams:1",
  "seams:2",
  "seams:3",
  "seams:4",
]);

const CAPTURED_VIDEOS = new Set(["getting-started"]);

const step = (
  id: string,
  n: number,
  title: string,
  body: string,
): TutorialStep => ({
  title,
  body,
  image: `/tutorials/${id}/${n}.webp`,
  imageKind: CAPTURED_STEPS.has(`${id}:${n}`) ? "capture" : "placeholder",
});

const clip = (id: string) => ({
  video: `/tutorials/${id}/clip.mp4`,
  videoKind: (CAPTURED_VIDEOS.has(id) ? "capture" : "placeholder") as MediaKind,
});

export const TUTORIALS: Tutorial[] = [
  {
    id: "getting-started",
    title: "Start a property",
    category: "Getting started",
    blurb: "Name the job, pick feet or metres, and land on the sketch.",
    apps: ["beta", "beta2"],
    ...clip("getting-started"),
    steps: [
      step("getting-started", 1, "Name the job", "Type the address or a job name. Pick Feet & inches or Metres. You can switch later."),
      step("getting-started", 2, "Open the sketch", "Tap Start property. The plan fills the screen. Undo, settings, and the laser stay in the header."),
      step("getting-started", 3, "Nothing is lost", "Help, the laser, and export open on top of the drawing. Closing them puts you back on the same plan."),
      step("getting-started", 4, "Add the first room", "Tap Add room. Draw it, type the size, or trace a photo. Tap a wall length whenever you want to correct it."),
    ],
  },
  {
    id: "add-room",
    title: "Add a room",
    category: "Getting started",
    blurb: "Put the next room on the plan without leaving the sketch.",
    apps: ["beta", "beta2"],
    steps: [
      step("add-room", 1, "Tap Add room", "The sheet lists every way to make a room: draw, type a size, photo, or a walk."),
      step("add-room", 2, "Name it", "Living, MBR, closet — the name is on the plan and in the PDF."),
      step("add-room", 3, "Place it", "A drawn or typed room drops next to the rooms you already have."),
      step("add-room", 4, "Next room", "Open the room and tap Next room when the lengths look right."),
    ],
  },
  {
    id: "draw-room",
    title: "Draw on the grid",
    category: "Drawing rooms",
    blurb: "Drag a rectangle, then nudge walls until the size is right.",
    apps: ["beta", "beta2"],
    ...clip("draw-room"),
    steps: [
      step("draw-room", 1, "Choose Draw", "From Add room, pick Draw. Or tap Draw on the toolbar."),
      step("draw-room", 2, "Drag the box", "Drag on the grid. The size shows as you drag. Let go to drop the room."),
      step("draw-room", 3, "Move a wall", "Tap the room. Drag a side or a corner. The shape stays square to the grid."),
      step("draw-room", 4, "Type the real length", "Tap the length on a wall and type 12'6\" or 3.80. Only that wall changes."),
    ],
  },
  {
    id: "trace",
    title: "Trace over a photo",
    category: "Drawing rooms",
    blurb: "Put a sketch or photo under the plan and draw on top of it.",
    apps: ["beta", "beta2"],
    ...clip("trace"),
    steps: [
      step("trace", 1, "Open the trace", "On the level bar, open the trace for this floor."),
      step("trace", 2, "Add the picture", "Take a photo or pick one from the gallery. It sits behind the rooms."),
      step("trace", 3, "Line it up", "Drag, pinch, and rotate until the walls sit where you want them. Lower the opacity if it fights the lines."),
      step("trace", 4, "Calibrate", "Tap Calibrate, then two points you know the distance between, and type that distance."),
      step("trace", 5, "Draw on top", "Draw rooms over the picture. A length you type always wins over the trace."),
    ],
  },
  {
    id: "edit-walls",
    title: "Edit a wall length",
    category: "Drawing rooms",
    blurb: "Tap a wall and type the tape or laser reading.",
    apps: ["beta", "beta2"],
    steps: [
      step("edit-walls", 1, "Tap the length", "Tap the length label on the wall. That wall is highlighted."),
      step("edit-walls", 2, "The room panel", "Wall lengths are listed with a name (Top, Right, …). The one you tapped is ready to edit."),
      step("edit-walls", 3, "Type it", "12, 12.5, or 12'6\" in feet. Metres take 3.8 or 380cm. Enter commits it."),
      step("edit-walls", 4, "Only that wall", "The opposite wall stays put. If the outline no longer closes square, the gap is shown. Close room is still there in Draw walls."),
      step("edit-walls", 5, "Undo", "The header Undo puts the previous shape back. Your other rooms stay as they were."),
    ],
  },
  {
    id: "laser",
    title: "Connect the DISTO",
    category: "Laser / DISTO",
    blurb: "A Leica DISTO D2 fills the wall you tapped.",
    apps: ["beta", "beta2"],
    ...clip("laser"),
    steps: [
      step("laser", 1, "Tap the ruler", "Connect laser is in the header. The dot is gray when off, amber while it looks, green when the DISTO is on."),
      step("laser", 2, "Wake the laser", "Turn Bluetooth on. Hold the DISTO Bluetooth key until it is discoverable. Or switch on Simulate DISTO to practice."),
      step("laser", 3, "Pick the DISTO", "Tap the name in the list. Floorline remembers it and reconnects next time. The plan is not touched if the link drops."),
      step("laser", 4, "Tap a wall, press DIST", "Select the wall on the sketch, then press DIST on the laser. The length shows in feet-and-inches or metres."),
      step("laser", 5, "Next wall", "The highlight moves to the next wall, then the next room. Re-shoot restores the length you just replaced."),
    ],
  },
  {
    id: "draw-walls",
    title: "Draw walls with the laser",
    category: "Laser / DISTO",
    blurb: "Walk the room: direction, then a shot, one wall at a time.",
    apps: ["beta", "beta2"],
    ...clip("draw-walls"),
    steps: [
      step("draw-walls", 1, "Draw walls", "In the laser sheet, tap Draw walls. The pad stays on the sketch."),
      step("draw-walls", 2, "Aim the arrow", "Up, down, left, right, the four 45° diagonals, or type an angle. 0° is up the page, clockwise."),
      step("draw-walls", 3, "Take the shot", "Press DIST, or type the length and tap Add wall. The segment grows from the last corner."),
      step("draw-walls", 4, "Close the room", "Tap Close room, or keep shooting until a shot lands within 6 inches of the start. The gap is shown."),
      step("draw-walls", 5, "Undo a shot", "Undo on the pad removes the last wall, opening, or closet. The header Undo removes the room after you close it."),
    ],
  },
  {
    id: "add-opening",
    title: "Add a door or opening",
    category: "Openings & closets",
    blurb: "Door, doorway, or cased opening on the wall you just shot.",
    apps: ["beta", "beta2"],
    ...clip("add-opening"),
    steps: [
      step("add-opening", 1, "Current wall", "Shoot at least one wall, then tap Add opening. It sits on that wall."),
      step("add-opening", 2, "Pick the kind", "Door, Opening, or Cased. A cased opening is trimmed and has no door slab."),
      step("add-opening", 3, "Width, then offset", "The next laser shot fills the width, the one after fills the center measured from the corner. You can type both."),
      step("add-opening", 4, "Transition", "Auto, T-mold, or No transition. Place opening draws it on the wall."),
    ],
  },
  {
    id: "add-closet",
    title: "Add a closet",
    category: "Openings & closets",
    blurb: "A closet off the current wall, with its own square footage.",
    apps: ["beta", "beta2"],
    ...clip("add-closet"),
    steps: [
      step("add-closet", 1, "Add closet", "From Draw walls, tap Add closet. Name it — MBR closet, linen, pantry."),
      step("add-closet", 2, "In the total or separate", "Include in the room's total rolls the square footage into the parent. Leave it off to list the closet on its own."),
      step("add-closet", 3, "Width and depth", "Type or shoot the width along the wall and the depth off the wall. Flip outside or inside the room."),
      step("add-closet", 4, "Or walk it", "Arrow draw uses the same directions and DISTO shots, then you close the closet."),
      step("add-closet", 5, "On the plan", "The label reads like MBR closet 6'-7\" × 7'-4\" = 48.23 sf."),
    ],
  },
  {
    id: "photos",
    title: "Photos and video",
    category: "Photos",
    blurb: "A picture or clip on the room, with time and GPS when the phone has them.",
    apps: ["beta", "beta2"],
    steps: [
      step("photos", 1, "Open the room", "Tap the room. Photos & video is in the panel."),
      step("photos", 2, "Camera or gallery", "Take a photo, pick one, record a video, or pick a video. You stay on the sketch."),
      step("photos", 3, "Stamp", "Each one keeps the time. GPS is added when location is allowed."),
      step("photos", 4, "On the plan and the PDF", "Thumbnails sit on the room. They are included when you share the PDF."),
    ],
  },
  {
    id: "materials",
    title: "Material and box estimate",
    category: "Estimates & PDF",
    blurb: "Square footage, waste, LVP boxes, and carpet cuts.",
    apps: ["beta", "beta2"],
    ...clip("materials"),
    steps: [
      step("materials", 1, "Open Materials", "Tap Materials. The total for the job is at the top. Switch floors if you have more than one."),
      step("materials", 2, "LVP boxes", "Hard-surface rooms use the waste percent and square feet per box from job settings."),
      step("materials", 3, "Carpet", "Carpet rooms show roll width, seams, and the cuts to order."),
      step("materials", 4, "Change the defaults", "Job settings (the sliders icon) holds waste, roll width, trim, and stair style for this job."),
    ],
  },
  {
    id: "pdf",
    title: "PDF and export",
    category: "Estimates & PDF",
    blurb: "Share the plan, a PNG, or a backup. Nothing uploads until you share it.",
    apps: ["beta", "beta2"],
    steps: [
      step("pdf", 1, "Tap Export", "Export is on the toolbar. The sheet opens on top of the sketch."),
      step("pdf", 2, "Share the PDF", "Share PDF floor plan sends a sheet with the plan, materials, and room photos."),
      step("pdf", 3, "Picture or backup", "PNG is the drawing. JSON is a backup you can import on another phone."),
      step("pdf", 4, "Back to the plan", "Close the sheet. The rooms are exactly where you left them."),
    ],
  },
  {
    id: "quote",
    title: "Customer quote",
    category: "Estimates & PDF",
    blurb: "A priced PDF from the plan, with your logo and price list.",
    apps: ["beta", "beta2"],
    steps: [
      step("quote", 1, "Open Quote", "Quote sits on the square-footage bar. The sheet opens on top of the sketch."),
      step("quote", 2, "Your business", "Business holds the name, phone, email, license and logo. It starts as SCG — replace it once and it stays on this phone."),
      step("quote", 3, "Fill in prices", "Every rate starts at $0. Type your price and it becomes the default for the next quote. Quantities come from the rooms."),
      step("quote", 4, "Share the PDF", "Share PDF sends the quote, with a small plan on it, through the Android share sheet. It is also saved on the job."),
    ],
  },
  {
    id: "seams",
    title: "Carpet seams and cuts",
    category: "Estimates & PDF",
    blurb: "12 ft rolls, T-seam fills, a cut list and a diagram on the plan.",
    apps: ["beta", "beta2"],
    steps: [
      step("seams", 1, "Open Seams", "Seams is on the square-footage bar. The plan stays up so you can see the lines."),
      step("seams", 2, "Roll and direction", "Pick 12, 13'6\" or 15. Auto direction chooses the way with less waste. Rotate pile turns it 90°."),
      step("seams", 3, "Drag a seam", "Drag a dashed seam, or use the slider. Waste, linear feet and the cut list update as it moves."),
      step("seams", 4, "T-seams and the cut sheet", "A fill longer than the roll is cross-joined. Piece numbers and pile arrows are on the plan, the job PDF and the installer cut sheet."),
    ],
  },
  {
    id: "arcore",
    title: "ARCore room scan",
    category: "ARCore scan",
    blurb: "Walk the phone around the room and get an outline to correct.",
    apps: ["beta2"],
    ...clip("arcore"),
    steps: [
      step("arcore", 1, "Start the scan", "Add a room and choose the AR scan. Beta 2 asks for the camera."),
      step("arcore", 2, "Move slowly", "Point at the floor and walk the perimeter. Keep the phone steady."),
      step("arcore", 3, "Accept the outline", "The scan becomes a room on the plan. It is a starting shape, not the final measure."),
      step("arcore", 4, "Fix the lengths", "Tap each wall and type the tape or DISTO reading. Typed lengths replace the scan."),
    ],
  },
];

export function tutorialsFor(app: TutorialApp): Tutorial[] {
  return TUTORIALS.filter((t) => t.apps.includes(app));
}

export function tutorialById(app: TutorialApp, id: string): Tutorial | undefined {
  return tutorialsFor(app).find((t) => t.id === id);
}

export const WELCOME_KEY = "floorline.tutorials.welcome";

export function welcomePending(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) !== "1";
  } catch {
    return false;
  }
}

export function dismissWelcome() {
  try {
    localStorage.setItem(WELCOME_KEY, "1");
  } catch {
    /* private mode */
  }
}

export function resetWelcome() {
  try {
    localStorage.removeItem(WELCOME_KEY);
  } catch {
    /* ignore */
  }
}
