import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { extractJsonObject, normalizePlan } from "./normalize";
import type { FloorPlan, Units } from "./types";

const ImageInput = z.object({
  mime: z.literal("image/jpeg"),
  data: z.string().min(32).max(1_800_000),
});

const InputSchema = z.object({
  images: z.array(ImageInput).min(1).max(6),
  hint: z.string().max(600).optional(),
  units: z.enum(["ft", "m"]).default("ft"),
  sourceKind: z.enum(["photos", "video", "mixed"]).optional(),
});

export type AnalyzeResult =
  | { ok: true; plan: FloorPlan }
  | { ok: false; error: string };

const FLOOR_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "units",
    "overallWidth",
    "overallDepth",
    "northAngle",
    "rooms",
    "openings",
    "furniture",
    "notes",
    "confidence",
  ],
  properties: {
    title: { type: "string" },
    units: { type: "string", enum: ["ft", "m"] },
    overallWidth: { type: "number" },
    overallDepth: { type: "number" },
    northAngle: { type: "number" },
    notes: { type: "string" },
    confidence: { type: "number" },
    rooms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "type", "x", "y", "w", "h"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: {
            type: "string",
            enum: [
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
            ],
          },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
        },
      },
    },
    openings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "roomId", "wall", "offset", "width", "swing"],
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["door", "window", "opening", "sliding"] },
          roomId: { type: "string" },
          wall: { type: "string", enum: ["n", "s", "e", "w"] },
          offset: { type: "number" },
          width: { type: "number" },
          swing: {
            type: "string",
            enum: ["in-left", "in-right", "out-left", "out-right", "none"],
          },
        },
      },
    },
    furniture: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "label", "x", "y", "w", "h", "rotation"],
        properties: {
          id: { type: "string" },
          kind: { type: "string" },
          label: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
          rotation: { type: "number" },
        },
      },
    },
  },
} as const;

function systemPrompt(units: Units): string {
  return `You are an architectural surveyor reconstructing a 2D floor plan from interior photographs or video frames.

Coordinate system:
- Origin at the north-west (top-left) of the bounding box
- +x is east (right), +y is south (down) so the drawing matches a typical plan sheet
- Units are ${units === "m" ? "metres" : "feet"}
- Rooms are axis-aligned rectangles. Represent L-shapes as two named rectangles that share a wall
- Rooms must share walls and fill the overall footprint without large unexplained gaps or overlaps
- Infer dimensions from typical architectural sizes when no tape is visible (doors 2.5–3 ft / 0.8–0.95 m, halls 3–4 ft, bedrooms 10–14 ft, baths 5–8 ft). Stay internally consistent
- Openings sit on a room wall. offset is measured from the west end of n/s walls, or the north end of e/w walls
- Door swing: in-left / in-right / out-left / out-right relative to the room that owns the opening. Windows and cased openings use swing "none"
- Include visible furniture as simplified blocks with kind in: sofa, bed, table, island, fridge, stove, sink, toilet, shower, bathtub, desk, chair, tv, wardrobe, nightstand, plant
- If frames show a single room, still produce a complete plan of that room plus any adjacent spaces you can reasonably infer, and lower confidence
- If the images already show a floor plan, trace it
- Never invent a second storey unless clearly shown
- confidence is 0–1 reflecting how complete the reconstruction is
- title should be a short project name, not a sentence`;
}

function userPrompt(input: { hint?: string; units: Units; count: number; sourceKind?: "photos" | "video" | "mixed" }): string {
  const hint = input.hint?.trim();
  const source =
    input.sourceKind === "video"
      ? "These stills were sampled from a walkthrough video."
      : input.sourceKind === "mixed"
        ? "These stills mix photographs and frames sampled from video."
        : "These stills are photographs of the space.";
  return [
    `Reconstruct a measured floor plan from these ${input.count} frames.`,
    source,
    `Use ${input.units === "m" ? "metres" : "feet"} for every length.`,
    hint ? `Surveyor notes from the occupant: ${hint}` : "",
    "Return only the floor plan object.",
  ]
    .filter(Boolean)
    .join("\n");
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "high" | "low" } };

async function callXai(args: {
  apiKey: string;
  parts: ContentPart[];
  units: Units;
  useSchema: boolean;
}): Promise<string> {
  const body: Record<string, unknown> = {
    model: "grok-4.5",
    max_tokens: 6000,
    messages: [
      { role: "system", content: systemPrompt(args.units) },
      { role: "user", content: args.parts },
    ],
  };
  if (args.useSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "floor_plan",
        strict: true,
        schema: FLOOR_PLAN_SCHEMA,
      },
    };
  } else {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`xAI API error ${res.status}${detail ? `: ${detail.slice(0, 280)}` : ""}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("The model returned an empty response.");
  return text;
}

export const analyzeFloorPlan = createServerFn({ method: "POST" })
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<AnalyzeResult> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        error: "Tracing is unavailable in this environment. Open the sample loft to explore the sheet.",
      };
    }

    const parts: ContentPart[] = data.images.map((image, index) => ({
      type: "image_url" as const,
      image_url: {
        url: `data:${image.mime};base64,${image.data}`,
        detail: index < 4 ? "high" : "low",
      },
    }));
    parts.push({
      type: "text",
      text: userPrompt({
        hint: data.hint,
        units: data.units,
        count: data.images.length,
        sourceKind: data.sourceKind,
      }),
    });

    try {
      let text: string;
      try {
        text = await callXai({ apiKey, parts, units: data.units, useSchema: true });
      } catch (first) {
        const message = first instanceof Error ? first.message : "";
        if (!message.includes("xAI API error")) throw first;
        text = await callXai({ apiKey, parts, units: data.units, useSchema: false });
      }
      const parsed = extractJsonObject(text);
      const plan = normalizePlan(parsed, {
        sourceKind: data.sourceKind ?? "photos",
        sourceCount: data.images.length,
        units: data.units,
      });
      return { ok: true, plan };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tracing failed.";
      return { ok: false, error: message.replace(/^xAI API error \d+:\s*/, "").slice(0, 280) };
    }
  });
