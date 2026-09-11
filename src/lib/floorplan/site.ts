import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const reverseSite = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).parse(input),
  )
  .handler(async ({ data }): Promise<{ address: string | null }> => {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(data.lat))}&lon=${encodeURIComponent(String(data.lng))}&zoom=18&addressdetails=1`;
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "Floorline/1.0 (floor-plan survey)" },
      });
      if (!res.ok) return { address: null };
      const json = (await res.json()) as {
        address?: {
          house_number?: string;
          road?: string;
          neighbourhood?: string;
          suburb?: string;
          city?: string;
          town?: string;
          village?: string;
        };
        name?: string;
      };
      const a = json.address ?? {};
      const street = [a.house_number, a.road].filter(Boolean).join(" ");
      const place = a.neighbourhood || a.suburb || a.city || a.town || a.village || json.name;
      const address = [street, place].filter(Boolean).join(", ").slice(0, 80);
      return { address: address || null };
    } catch {
      return { address: null };
    }
  });
