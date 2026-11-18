# Floorline

Turn a walkthrough into an estimated floor plan.

Photograph a space, film a guided walk, or drop a clip. Floorline traces walls, doors, windows, and furniture onto a sheet you can restyle, dimension, and export.

Dimensions traced from photos are estimates, not measurements. A DISTO laser shot measures a room's width or depth, and a plan is only labelled "measured" once every room has a laser-measured dimension — otherwise it is labelled "estimated". Verify dimensions with a tape before building.

## What it does

- **Guided walk** — live camera prompts for each room, with Start, Pause, and Stop
- **Photos and video** — drop a survey or shoot stills
- **Auto sketch** — walls first, then openings and furniture
- **Studio** — restyle (sheet, blueprint, ink, sketch), set units, export SVG / PNG / JSON
- **Leica DISTO D2** — Bluetooth laser shots as room width or depth (Chrome or Edge)

Plans save on this device. No account required.

## Run it

```bash
npm install
npm run dev
```

Then open the app in your browser.

```bash
npm run build
npm run typecheck
```

## Stack

TanStack Start, React 19, Tailwind v4, Zustand.
