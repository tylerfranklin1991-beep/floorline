import type { FloorPlan, HeadingSample, Opening, SiteFix, SurveySite, WallSide } from "./types";

export const EMPTY_SITE: SurveySite = { fix: null, headings: [], track: [] };

export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function cardinalFromHeading(deg: number): WallSide {
  const d = normalizeDeg(deg);
  if (d >= 315 || d < 45) return "n";
  if (d < 135) return "e";
  if (d < 225) return "s";
  return "w";
}

export function cardinalLabel(deg: number): string {
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names[Math.round(normalizeDeg(deg) / 45) % 8];
}

export function formatCoords(lat: number, lng: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(5)}°${ns} ${Math.abs(lng).toFixed(5)}°${ew}`;
}

export function formatAccuracy(meters: number): string {
  if (!Number.isFinite(meters)) return "";
  if (meters < 10) return `±${Math.round(meters)} m`;
  if (meters < 100) return `±${Math.round(meters)} m`;
  return `±${Math.round(meters / 10) * 10} m`;
}

export function headingFromOrientation(event: DeviceOrientationEvent): number | null {
  const webkit = (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
  if (typeof webkit === "number" && Number.isFinite(webkit)) return normalizeDeg(webkit);
  if (typeof event.alpha === "number" && Number.isFinite(event.alpha)) {
    return normalizeDeg(360 - event.alpha);
  }
  return null;
}

export async function startCompass(onHeading: (deg: number) => void): Promise<() => void> {
  if (typeof window === "undefined" || typeof window.DeviceOrientationEvent === "undefined") {
    return () => {};
  }
  const DOE = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<string>;
  };
  try {
    if (typeof DOE.requestPermission === "function") {
      const permission = await DOE.requestPermission();
      if (permission !== "granted") return () => {};
    }
  } catch {
    return () => {};
  }
  const handler = (event: DeviceOrientationEvent) => {
    const heading = headingFromOrientation(event);
    if (heading != null) onHeading(heading);
  };
  window.addEventListener("deviceorientationabsolute", handler as EventListener, true);
  window.addEventListener("deviceorientation", handler as EventListener, true);
  return () => {
    window.removeEventListener("deviceorientationabsolute", handler as EventListener, true);
    window.removeEventListener("deviceorientation", handler as EventListener, true);
  };
}

export function startGps(
  onFix: (coords: { lat: number; lng: number; accuracy: number; altitude: number | null }) => void,
): () => void {
  if (typeof navigator === "undefined" || !navigator.geolocation) return () => {};
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      onFix({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy || 999,
        altitude: typeof pos.coords.altitude === "number" ? pos.coords.altitude : null,
      });
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

export async function requestGpsFix(): Promise<{
  lat: number;
  lng: number;
  accuracy: number;
  altitude: number | null;
} | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), 8000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(timer);
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy || 999,
          altitude: typeof pos.coords.altitude === "number" ? pos.coords.altitude : null,
        });
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 5000 },
    );
  });
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearingDegrees(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return normalizeDeg((Math.atan2(y, x) * 180) / Math.PI);
}

export function appendTrackPoint(
  track: { lat: number; lng: number }[],
  point: { lat: number; lng: number; accuracy: number },
): { lat: number; lng: number }[] {
  if (point.accuracy > 40) return track;
  const last = track[track.length - 1];
  if (last && haversineMeters(last, point) < 4) return track;
  return [...track, { lat: point.lat, lng: point.lng }].slice(-48);
}

export function trackSpan(track: { lat: number; lng: number }[]): { widthM: number; depthM: number; bearing: number } | null {
  if (track.length < 4) return null;
  let minLat = track[0].lat;
  let maxLat = track[0].lat;
  let minLng = track[0].lng;
  let maxLng = track[0].lng;
  for (const p of track) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  const south = { lat: minLat, lng: (minLng + maxLng) / 2 };
  const north = { lat: maxLat, lng: (minLng + maxLng) / 2 };
  const west = { lat: (minLat + maxLat) / 2, lng: minLng };
  const east = { lat: (minLat + maxLat) / 2, lng: maxLng };
  const depthM = haversineMeters(south, north);
  const widthM = haversineMeters(west, east);
  if (depthM < 6 && widthM < 6) return null;
  const first = track[0];
  const last = track[track.length - 1];
  return { widthM, depthM, bearing: Math.round(bearingDegrees(first, last)) };
}

export function osmTileUrl(lat: number, lng: number, zoom = 16): string {
  const n = 2 ** zoom;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = toRad(lat);
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

export function buildSiteHint(site: SurveySite): string {
  const parts: string[] = [];
  if (site.fix) {
    const where = site.fix.address ? `${site.fix.address}. ` : "";
    parts.push(
      `GPS site ${formatCoords(site.fix.lat, site.fix.lng)} (${formatAccuracy(site.fix.accuracy)}). ${where}`.trim(),
    );
  }
  if (site.headings.length > 0) {
    const lines = site.headings.slice(0, 8).map((item) => {
      return `${item.label} facing ${Math.round(item.heading)}° ${cardinalLabel(item.heading)}`;
    });
    parts.push(
      `Compass while filming: ${lines.join("; ")}. Orient true north to the top of the sheet and place the entry on the facade that matches the entry heading.`,
    );
  }
  const span = trackSpan(site.track);
  if (span) {
    parts.push(
      `GPS walk span about ${Math.round(span.widthM)}×${Math.round(span.depthM)} m, path bearing ${span.bearing}° from north.`,
    );
  }
  return parts.join(" ");
}

const OUTWARD: Record<WallSide, number> = { n: 0, e: 90, s: 180, w: 270 };

function entryOpening(plan: FloorPlan): Opening | undefined {
  return (
    plan.openings.find((item) => item.kind === "door" && /liv|hall|entry|foyer/i.test(item.roomId)) ??
    plan.openings.find((item) => item.kind === "door")
  );
}

export function alignNorthArrow(plan: FloorPlan): FloorPlan {
  const sample =
    plan.headings?.find((item) => /entry|door/i.test(item.label)) ??
    plan.headings?.[0] ??
    null;
  const opening = entryOpening(plan);
  if (sample && opening) {
    const northAngle = Math.round(normalizeDeg(sample.heading - OUTWARD[opening.wall]));
    return { ...plan, northAngle };
  }
  if (plan.site?.heading != null) {
    return { ...plan, northAngle: Math.round(normalizeDeg(plan.site.heading)) };
  }
  return plan;
}

export function siteFromFix(
  coords: { lat: number; lng: number; accuracy: number; altitude: number | null },
  heading: number | null,
  address: string | null,
): SiteFix {
  return {
    lat: coords.lat,
    lng: coords.lng,
    accuracy: coords.accuracy,
    heading,
    altitude: coords.altitude,
    address,
    capturedAt: Date.now(),
  };
}

export function attachSite(plan: FloorPlan, site: SurveySite): FloorPlan {
  return alignNorthArrow({
    ...plan,
    site: site.fix ?? plan.site,
    headings: site.headings.length ? site.headings : plan.headings,
    track: site.track.length ? site.track : plan.track,
  });
}

export function mergeHeading(samples: HeadingSample[], next: HeadingSample): HeadingSample[] {
  const without = samples.filter((item) => item.label !== next.label);
  return [...without, next].slice(-16);
}
