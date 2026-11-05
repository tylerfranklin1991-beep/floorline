/**
 * Static SPA build for the Android (Capacitor) app: `npm run build:android`.
 * No Nitro / server runtime: the output in dist-android/ is bundled into the
 * APK, so the field-mode home screen works fully offline. Server functions
 * (the /classic AI studio, auth) are NOT available inside the app.
 */
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  define: { "import.meta.env.VITE_NATIVE_APP": JSON.stringify("true") },
  plugins: [
    tailwindcss(),
    tanstackStart({
      spa: {
        enabled: true,
        prerender: { outputPath: "/index.html", crawlLinks: false },
      },
    }),
    viteReact(),
  ],
});
