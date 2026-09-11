import type { MediaItem } from "./media";

export const SAMPLE_SURVEY_FILES = [
  { src: "/samples/living.jpg", name: "living.jpg", label: "Living" },
  { src: "/samples/kitchen.jpg", name: "kitchen.jpg", label: "Kitchen" },
  { src: "/samples/bedroom.jpg", name: "bedroom.jpg", label: "Bedroom" },
  { src: "/samples/bath.jpg", name: "bath.jpg", label: "Bath" },
] as const;

export const SAMPLE_SURVEY_HINT =
  "Compact loft. Living opens east into the kitchen. Bedroom and bath are private rooms along the south. Prefer feet.";

export async function loadSampleSurvey(): Promise<MediaItem[]> {
  const items: MediaItem[] = [];
  for (const entry of SAMPLE_SURVEY_FILES) {
    const res = await fetch(entry.src);
    if (!res.ok) throw new Error("Could not load the sample survey.");
    const blob = await res.blob();
    const file = new File([blob], entry.name, { type: "image/jpeg" });
    items.push({
      id: `sample-${entry.name}`,
      file,
      kind: "image",
      previewUrl: URL.createObjectURL(blob),
    });
  }
  return items;
}
