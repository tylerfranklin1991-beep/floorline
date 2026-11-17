/**
 * DISTO link for the sketch screen: native BLE on Android, Web Bluetooth where
 * the browser has it, and a simulated DISTO for testing without the laser.
 * Readings are metres from {@link parseDistanceMeters}. Sketch state lives
 * elsewhere — a drop or reconnect only changes this link.
 */

import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { useSyncExternalStore } from "react";
import {
  DISTO_BASIC,
  DISTO_DISTANCE,
  DISTO_DISTANCE_UNIT,
  DISTO_MODEL,
  DISTO_SERVICE,
  encodeMeters,
  parseDistanceMeters,
  parseDisplayUnit,
  parseModelName,
} from "./disto-protocol.ts";
import { isNativeApp } from "./native.ts";

export type DistoStatus =
  | "off"
  | "scanning"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export type DistoDevice = { id: string; name: string; rssi: number | null };

export type DistoSnapshot = {
  status: DistoStatus;
  name: string | null;
  error: string | null;
  devices: DistoDevice[];
  mock: boolean;
  last: { meters: number; at: number } | null;
  /** Verified display unit ("m"), or null when the device's code isn't verified. */
  displayUnit: string | null;
};

const MOCK_KEY = "floorline.debug.distoMock";
const LAST_WEB_KEY = "floorline.disto.webId";

type NativeStatus = { state?: string; name?: string; address?: string; error?: string };
type NativeBytes = { kind?: string; bytes?: number[] };
type NativeDevice = { id?: string; name?: string; rssi?: number };

type DistoBlePlugin = {
  ensurePermissions: () => Promise<{ granted: boolean }>;
  startScan: () => Promise<void>;
  stopScan: () => Promise<void>;
  connect: (opts: { address: string; name?: string }) => Promise<void>;
  disconnect: () => Promise<void>;
  forget: () => Promise<void>;
  remembered: () => Promise<{ address?: string | null; name?: string | null }>;
  addListener: (
    event: "status" | "device" | "bytes",
    cb: (payload: NativeStatus & NativeBytes & NativeDevice) => void,
  ) => Promise<PluginListenerHandle>;
};

const DistoBle = registerPlugin<DistoBlePlugin>("DistoBle");

let state: DistoSnapshot = {
  status: "off",
  name: null,
  error: null,
  devices: [],
  mock: false,
  last: null,
  displayUnit: null,
};

const listeners = new Set<() => void>();
const readings = new Set<(meters: number) => void>();
let lastEmit = { meters: NaN, at: 0 };
let nativeListening = false;
let webDevice: BluetoothDevice | null = null;

function publish() {
  for (const listener of listeners) listener();
}

function patch(next: Partial<DistoSnapshot>) {
  state = { ...state, ...next };
  publish();
}

export function getDisto(): DistoSnapshot {
  return state;
}

export function subscribeDisto(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDisto(): DistoSnapshot {
  return useSyncExternalStore(subscribeDisto, getDisto, getDisto);
}

export function onDistoReading(cb: (meters: number) => void): () => void {
  readings.add(cb);
  return () => readings.delete(cb);
}

export function distoMockEnabled(): boolean {
  try {
    return localStorage.getItem(MOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDistoMock(on: boolean) {
  try {
    localStorage.setItem(MOCK_KEY, on ? "1" : "0");
  } catch {
    /* private mode */
  }
  if (on) {
    patch({
      mock: true,
      status: "connected",
      name: "DISTO D2 (simulated)",
      error: null,
      devices: [],
    });
  } else if (state.mock) {
    patch({ mock: false, status: "off", name: null, error: null, last: null });
  } else {
    patch({ mock: false });
  }
}

function emitMeters(meters: number) {
  const now = Date.now();
  if (Math.abs(meters - lastEmit.meters) < 1e-4 && now - lastEmit.at < 700) return;
  lastEmit = { meters, at: now };
  patch({ last: { meters, at: now }, error: null, status: state.status === "off" ? "connected" : state.status });
  for (const cb of readings) cb(meters);
}

/** Push a length through the real packet parser. Used by the simulator. */
export function publishMockMeters(meters: number): string | null {
  const parsed = parseDistanceMeters(encodeMeters(meters));
  if (!parsed.ok) return parsed.reason;
  if (!state.mock && state.status !== "connected") return "Connect the laser first.";
  emitMeters(parsed.meters);
  return null;
}

function handleBytes(kind: string, bytes: Uint8Array) {
  if (kind === "model") {
    const name = parseModelName(bytes);
    patch({ name: name === "DISTO" ? state.name : `DISTO ${name}` });
    return;
  }
  if (kind === "unit") {
    const unit = parseDisplayUnit(bytes);
    patch({ displayUnit: unit && !unit.unverified ? unit.label : null });
    return;
  }
  const parsed = parseDistanceMeters(bytes);
  if (!parsed.ok) return;
  emitMeters(parsed.meters);
}

async function listenNative() {
  if (nativeListening) return;
  nativeListening = true;
  await DistoBle.addListener("status", (event) => {
    const status = (event.state ?? "disconnected") as DistoStatus;
    patch({
      status,
      name: event.name ?? state.name,
      error: event.error ?? null,
    });
  });
  await DistoBle.addListener("device", (event) => {
    if (!event.id) return;
    const device = { id: event.id, name: event.name || "DISTO", rssi: event.rssi ?? null };
    const devices = state.devices.filter((d) => d.id !== device.id);
    devices.push(device);
    devices.sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
    patch({ devices: devices.slice(0, 12) });
  });
  await DistoBle.addListener("bytes", (event) => {
    if (!event.bytes) return;
    handleBytes(event.kind || "distance", Uint8Array.from(event.bytes));
  });
}

export async function connectLaser(): Promise<void> {
  if (distoMockEnabled() || state.mock) {
    setDistoMock(true);
    return;
  }
  if (isNativeApp()) {
    try {
      await listenNative();
      const perm = await DistoBle.ensurePermissions();
      if (!perm.granted) {
        patch({
          status: "disconnected",
          error: "Allow Bluetooth to connect the DISTO. On Android 11 and older, location is used only for the scan.",
        });
        return;
      }
      patch({ status: "scanning", error: null, devices: [] });
      await DistoBle.startScan();
    } catch (error) {
      patch({ status: "disconnected", error: message(error) });
    }
    return;
  }
  await connectWeb();
}

export async function connectDevice(id: string, name: string): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await listenNative();
    patch({ status: "connecting", name, error: null });
    await DistoBle.connect({ address: id, name });
  } catch (error) {
    patch({ status: "disconnected", error: message(error) });
  }
}

export async function disconnectLaser(): Promise<void> {
  if (state.mock) {
    setDistoMock(false);
    return;
  }
  try {
    if (isNativeApp()) await DistoBle.disconnect();
    else webDisconnect();
  } catch {
    /* already gone */
  }
  patch({ status: "disconnected", error: null });
}

export async function forgetLaser(): Promise<void> {
  try {
    if (isNativeApp()) await DistoBle.forget();
    else {
      webDisconnect();
      localStorage.removeItem(LAST_WEB_KEY);
    }
  } catch {
    /* ignore */
  }
  patch({ status: "off", name: null, error: null, devices: [], last: null });
}

export async function autoReconnect(): Promise<void> {
  if (distoMockEnabled()) {
    setDistoMock(true);
    return;
  }
  if (state.status === "connected" || state.status === "connecting") return;
  if (!isNativeApp()) {
    await reconnectWeb();
    return;
  }
  try {
    await listenNative();
    const saved = await DistoBle.remembered();
    if (!saved.address) return;
    const perm = await DistoBle.ensurePermissions();
    if (!perm.granted) {
      patch({
        status: "disconnected",
        name: saved.name || "DISTO",
        error: "Bluetooth permission is needed to reconnect the DISTO.",
      });
      return;
    }
    patch({ status: "connecting", name: saved.name || "DISTO", error: null });
    await DistoBle.connect({ address: saved.address, name: saved.name || undefined });
  } catch (error) {
    patch({ status: "disconnected", error: message(error) });
  }
}

function message(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "Couldn't reach the DISTO.";
}

async function connectWeb(): Promise<void> {
  const bluetooth = navigator.bluetooth;
  if (!bluetooth?.requestDevice) {
    patch({
      status: "disconnected",
      error: "This browser can't reach a DISTO. Use the Android app, or turn on Simulate DISTO.",
    });
    return;
  }
  try {
    const device = await bluetooth.requestDevice({
      filters: [{ namePrefix: "DISTO" }, { namePrefix: "Leica" }, { services: [DISTO_SERVICE] }],
      optionalServices: [DISTO_SERVICE],
    });
    await attachWeb(device);
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return;
    patch({ status: "disconnected", error: message(error) });
  }
}

async function reconnectWeb(): Promise<void> {
  const bluetooth = navigator.bluetooth as (Bluetooth & { getDevices?: () => Promise<BluetoothDevice[]> }) | undefined;
  if (!bluetooth?.getDevices) return;
  let id: string | null = null;
  try {
    id = localStorage.getItem(LAST_WEB_KEY);
  } catch {
    return;
  }
  if (!id) return;
  try {
    const devices = await bluetooth.getDevices();
    const device = devices.find((item) => item.id === id);
    if (device) await attachWeb(device);
  } catch {
    /* wait for the user to tap Connect */
  }
}

async function attachWeb(device: BluetoothDevice): Promise<void> {
  webDisconnect();
  webDevice = device;
  patch({ status: "connecting", name: device.name || "DISTO D2", error: null });
  const onGone = () => {
    if (webDevice !== device) return;
    webDevice = null;
    patch({ status: "disconnected", error: "DISTO disconnected. Tap Connect laser to try again." });
  };
  device.addEventListener("gattserverdisconnected", onGone);
  const server = await device.gatt?.connect();
  if (!server) throw new Error("Couldn't open a Bluetooth link to the DISTO.");
  const service = await server.getPrimaryService(DISTO_SERVICE);
  const distance = await service.getCharacteristic(DISTO_DISTANCE).catch(async () => service.getCharacteristic(DISTO_BASIC));
  distance.addEventListener("characteristicvaluechanged", () => {
    const value = distance.value;
    if (value) handleBytes(distance.uuid.endsWith("010d") ? "basic" : "distance", new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  });
  await distance.startNotifications();
  try {
    const unit = await service.getCharacteristic(DISTO_DISTANCE_UNIT);
    const read = await unit.readValue();
    handleBytes("unit", new Uint8Array(read.buffer, read.byteOffset, read.byteLength));
  } catch {
    /* unit characteristic is optional */
  }
  try {
    const model = await service.getCharacteristic(DISTO_MODEL);
    const read = await model.readValue();
    handleBytes("model", new Uint8Array(read.buffer, read.byteOffset, read.byteLength));
  } catch {
    /* model name is optional */
  }
  try {
    localStorage.setItem(LAST_WEB_KEY, device.id);
  } catch {
    /* ignore */
  }
  patch({ status: "connected", name: device.name || state.name || "DISTO D2", error: null });
}

function webDisconnect() {
  try {
    webDevice?.gatt?.disconnect();
  } catch {
    /* already gone */
  }
  webDevice = null;
}
