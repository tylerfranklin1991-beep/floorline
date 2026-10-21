import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.tylerfranklin.floorline.beta2",
  appName: "Floorline Beta 2",
  // Static SPA build from `npm run build:android` (vite.config.android.ts).
  webDir: "dist/client",
  android: {
    // Debug-friendly beta: lets you inspect the WebView via chrome://inspect.
    webContentsDebuggingEnabled: true,
  },
};

export default config;
