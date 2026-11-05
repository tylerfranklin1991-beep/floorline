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

## Android beta app (Capacitor)

The field mode ships as an installable Android debug app, **Floorline Beta**
(`com.tylerfranklin.floorline.beta`). It is a sideloaded beta, not a Play Store build.

The app bundles a static SPA build (`vite.config.android.ts`, output `dist/client`)
inside the APK, so field mode works fully offline. Anything that needs a server
(the `/classic` AI studio, sign-in) is not available inside the app.

Requirements: Node >= 20.19, JDK 17 or 21 (`JAVA_HOME`), and the Android SDK
(`ANDROID_HOME`, with `platforms;android-35` and `build-tools;35.0.0`), or
`android/local.properties` containing `sdk.dir=...`.

| Script | What it does |
| --- | --- |
| `npm run build:android` | Static SPA build into `dist/client` |
| `npm run android:sync` | Build, then copy the web assets into `android/` (`cap sync`) |
| `npm run android:build` | Sync, then `./gradlew assembleDebug` → `android/app/build/outputs/apk/debug/app-debug.apk` |
| `npm run android:install` | `adb install -r` that APK on a USB-connected phone |

To update the app on the phone: pull, run `npm run android:build`, then reinstall it with
`adb install -r`. Saved data is kept because the debug signing key stays the same on one
machine. If the key changes, uninstall the app first.

Notes:
- Camera walk uses `getUserMedia`. The app declares `CAMERA`, and Capacitor's WebView asks for it the first time.
- Photo slots use `<input capture>`, which opens the camera or file picker.
- AR corners (WebXR `immersive-ar`) is not supported in an Android WebView. The app detects that and
  disables it with a note. Use Chrome on Android for AR.
- Levels and stairs are part of field mode, so they work the same in the app and in the browser.
- Launcher icons come from `scripts/android-icons.py` (Pillow).
