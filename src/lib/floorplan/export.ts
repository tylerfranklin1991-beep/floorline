import { sheetLayout } from "./format";
import type { FloorPlan, PlanStyle } from "./types";

const PAPER: Record<PlanStyle, string> = {
  sheet: "#f4f0e6",
  ink: "#f7f4ec",
  sketch: "#efe6d3",
  blueprint: "#102436",
};

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function slugTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "floorline-plan";
}

export async function exportSvgElement(svg: SVGSVGElement, filename: string) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll(".is-sketching").forEach((node) => node.classList.remove("is-sketching"));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
  downloadBlob(`${filename}.svg`, new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
}

export async function exportPngElement(
  svg: SVGSVGElement,
  plan: FloorPlan,
  filename: string,
  style: PlanStyle = "sheet",
) {
  const layout = sheetLayout(plan);
  const scale = 48;
  const width = Math.round(layout.w * scale);
  const height = Math.round(layout.h * scale);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll(".is-sketching").forEach((node) => node.classList.remove("is-sketching"));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("viewBox", `${layout.x} ${layout.y} ${layout.w} ${layout.h}`);
  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await load(url);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not export PNG.");
    ctx.fillStyle = PAPER[style];
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    await new Promise<void>((resolve, reject) => {
      canvas.toBlob((png) => {
        if (!png) reject(new Error("Could not encode PNG."));
        else {
          downloadBlob(`${filename}.png`, png);
          resolve();
        }
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not rasterize the sheet."));
    img.src = url;
  });
}

export function exportJson(plan: FloorPlan, filename: string) {
  const json = JSON.stringify(plan, null, 2);
  downloadBlob(`${filename}.json`, new Blob([json], { type: "application/json" }));
}
