import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { extractJsonObject } from "./normalize";

const InputSchema = z.object({
  image: z.object({
    mime: z.literal("image/jpeg"),
    data: z.string().min(32).max(900_000),
  }),
  cueTitle: z.string().max(80),
  cueBody: z.string().max(280),
  needs: z.array(z.string().max(32)).max(8),
  spaces: z.array(z.string().max(24)).max(10),
});

export type CoachAdvice = {
  room: string;
  seen: string[];
  missing: string[];
  instruction: string;
  pass: boolean;
  quality: number;
};

export type CoachResult = { ok: true; advice: CoachAdvice } | { ok: false };

const SEEN = new Set([
  "door",
  "window",
  "floor",
  "wall-corner",
  "opening",
  "kitchen-run",
  "island",
  "sink",
  "hob",
  "bed",
  "bath-fixtures",
  "furniture",
  "hallway",
]);

function asAdvice(raw: unknown): CoachAdvice | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const instruction = typeof data.instruction === "string" ? data.instruction.trim() : "";
  if (!instruction) return null;
  const seen = Array.isArray(data.seen)
    ? data.seen
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.toLowerCase())
        .filter((item) => SEEN.has(item))
        .slice(0, 8)
    : [];
  const missing = Array.isArray(data.missing)
    ? data.missing.filter((item): item is string => typeof item === "string").slice(0, 6)
    : [];
  const quality = typeof data.quality === "number" && Number.isFinite(data.quality) ? Math.min(1, Math.max(0, data.quality)) : 0.5;
  return {
    room: typeof data.room === "string" ? data.room : "unknown",
    seen,
    missing,
    instruction: instruction.slice(0, 140),
    pass: data.pass === true,
    quality,
  };
}

export const coachWalkFrame = createServerFn({ method: "POST" })
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<CoachResult> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false };

    const needs = data.needs.join(", ") || "a usable survey still";
    const spaces = data.spaces.join(", ") || "the interior";
    const prompt = `You are a live floor-plan surveyor coaching a walkthrough of: ${spaces}.
Current shot to capture: ${data.cueTitle}. Need in this frame: ${needs}.
Shot brief: ${data.cueBody}
Look at the image. Be strict — blur, ceiling-heavy, or a wall with no corner/door/floor should fail.
Write the instruction like a patient friend holding the phone with them. Max 12 words. No jargon (no jamb, sill, leaf, hob, lock, tracer).
Return JSON only:
{"room":"living|kitchen|dining|bedroom|bath|hallway|entry|office|outdoor|unknown","seen":["door","window","floor","wall-corner","opening","kitchen-run","island","sink","hob","bed","bath-fixtures","furniture","hallway"],"missing":["short gap"],"instruction":"one imperative, max 16 words, spatial","pass":false,"quality":0.0}`;

    try {
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "grok-4.5",
          max_tokens: 220,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: `data:${data.image.mime};base64,${data.image.data}`, detail: "low" } },
                { type: "text", text: prompt },
              ],
            },
          ],
        }),
      });
      if (!res.ok) return { ok: false };
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = json.choices?.[0]?.message?.content ?? "";
      if (!text) return { ok: false };
      const advice = asAdvice(extractJsonObject(text));
      if (!advice) return { ok: false };
      return { ok: true, advice };
    } catch {
      return { ok: false };
    }
  });
