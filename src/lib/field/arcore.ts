/** Bridge to the native ArScan Capacitor plugin (Floorline Beta 2, Android only). */
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { ArFrame } from "./arscan";

interface ArScanPlugin {
  checkAvailability(): Promise<{ status: string; supported: boolean; installed: boolean }>;
  start(): Promise<{ depth: boolean }>;
  stop(): Promise<void>;
  addListener(event: "frame", cb: (f: ArFrame) => void): Promise<PluginListenerHandle>;
}

export const ArScan = registerPlugin<ArScanPlugin>("ArScan");

export function hasNativeArScan(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("ArScan");
}
