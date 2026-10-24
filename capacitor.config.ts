import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.tylerfranklin.floorline",
  appName: "Floorline",
  // Static SPA build from `npm run build:android` (vite.config.android.ts).
  webDir: "dist/client",
  android: {
    // WebView debugging is on for debug builds only (Capacitor default).
  },
};

export default config;
