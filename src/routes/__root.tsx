import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { useEffect } from "react";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { Toaster } from "sonner";
import appCss from "../styles.css?url";

const APP_NAME = "Floorline";

function PointerUnlock() {
  useEffect(() => {
    const unlock = () => {
      if (document.body.style.pointerEvents === "none") document.body.style.pointerEvents = "";
      if (document.documentElement.style.pointerEvents === "none") document.documentElement.style.pointerEvents = "";
    };
    unlock();
    const timer = window.setInterval(unlock, 1500);
    return () => window.clearInterval(timer);
  }, []);
  return null;
}

/** Register the offline service worker in production builds only. */
function OfflineCache() {
  useEffect(() => {
    // The Android app ships its assets inside the APK, so it needs no SW.
    if (import.meta.env.DEV || import.meta.env.VITE_NATIVE_APP || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: APP_NAME },
      { name: "theme-color", content: "#f3efe4" },
      {
        name: "description",
        content: "Turn a walkthrough into a measured floor plan.",
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=Instrument+Serif:ital@0;1&display=swap",
      },
    ],
  }),
  component: () => (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <PointerUnlock />
        <OfflineCache />
        <AuthProvider>
          <Outlet />
          <Toaster
            theme="light"
            position="bottom-center"
            toastOptions={{
              classNames: {
                toast: "bg-card text-foreground border-border",
              },
            }}
          />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
