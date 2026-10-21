# Floorline

Turn a walkthrough into a measured floor plan.

Photograph a space, film a guided walk, or drop a clip. Floorline traces walls, doors, windows, and furniture onto a sheet you can restyle, dimension, and export.

## Field mode (default, `/`)

Built for walking a property on a phone:

1. **New property** — name/address, feet or metres.
2. **Add room** — pick a name (Kitchen, Bedroom, …), then choose how to make the shape:
   - **AR corners** — Android Chrome with ARCore: aim the crosshair at the floor in each corner and tap *Mark corner*. Walls are squared up automatically.
   - **Camera walk** — live camera on any phone: stand in a corner, tap *Turns left / Turns right* at each corner, optionally typing each wall's length. The outline closes and squares itself.
   - **Draw on grid** — drag a rectangle; drag corners and walls (snaps to a 6" / 10 cm grid). Rooms magnet to neighbouring walls so they connect.
   - **Type the size** — e.g. `12'6` × `10`.
3. **Name, measure, photo** — type each wall's length (12, 12.5, 12'6", 12-6 all work), add doors / windows / openings by tapping a wall, attach 1–2 photos that show as thumbnails on the plan.

Undo / redo everything. Plans autosave on the phone (localStorage + IndexedDB for photos) and the app caches itself for offline use after the first visit. Export as PNG, share image, PDF (print → Save as PDF), or JSON backup / re-import.

The original AI "trace from photos" studio is still available at `/classic` (needs `XAI_API_KEY`).

## Try it on an Android phone

The camera and AR only work over **HTTPS** (or `localhost`).

- Deploy (e.g. Vercel preview) and open the https URL in Chrome, **or**
- Run `npm run dev`, then on the phone use Chrome remote debugging port-forwarding (`chrome://inspect` → Port forwarding `8080 → localhost:8080`) and open `http://localhost:8080`.

AR corners needs "Google Play Services for AR" (preinstalled on Galaxy S25). Use Chrome's menu → *Add to Home screen* to install it like an app.

## Development

```bash
npm install
npm run dev        # http://localhost:8080
npm test           # unit tests (geometry, undo, export renderer, auth helpers)
npm run lint
npm run typecheck
npm run build
```

## Stack

TanStack Start, React 19, Tailwind v4, Zustand.
