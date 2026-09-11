export const DISTO_SERVICE = "3ab10100-f831-4395-b29d-570977d5bf94";
export const DISTO_DISTANCE = "3ab10101-f831-4395-b29d-570977d5bf94";
export const DISTO_UNIT = "3ab10102-f831-4395-b29d-570977d5bf94";
export const DISTO_COMMAND = "3ab10109-f831-4395-b29d-570977d5bf94";
export const DISTO_MODEL = "3ab1010c-f831-4395-b29d-570977d5bf94";

export type DistoUnit = "m" | "ft" | "in";

export type DistoReading = {
  meters: number;
  unit: DistoUnit;
  raw: number;
  name: string;
};

type Session = {
  device: BluetoothDevice;
  command: BluetoothRemoteGATTCharacteristic | null;
  onDisconnected: () => void;
};

let session: Session | null = null;

export function isDistoSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.bluetooth?.requestDevice);
}

export function distoSupportMessage(): string {
  if (typeof navigator === "undefined") return "Bluetooth is not available here.";
  if (!navigator.bluetooth) {
    return "This browser cannot talk to a DISTO over Bluetooth. Use Chrome or Edge on Android or a computer, or type the reading below.";
  }
  return "Turn Bluetooth on, hold the DISTO Bluetooth key for two seconds, then connect.";
}

function parseUnit(view: DataView | null): DistoUnit {
  if (!view || view.byteLength < 1) return "m";
  const code = view.byteLength >= 2 ? view.getUint16(0, true) : view.getUint8(0);
  if (code === 1) return "ft";
  if (code === 2) return "in";
  return "m";
}

function toMeters(raw: number, unit: DistoUnit): number {
  if (unit === "ft") return raw * 0.3048;
  if (unit === "in") return raw * 0.0254;
  return raw;
}

function decodeDistance(view: DataView | null): number | null {
  if (!view || view.byteLength < 4) return null;
  const value = view.getFloat32(0, true);
  if (!Number.isFinite(value) || value <= 0 || value > 500) return null;
  return value;
}

export async function connectDisto(handlers: {
  onReading: (reading: DistoReading) => void;
  onDisconnect: () => void;
}): Promise<{ name: string }> {
  if (!navigator.bluetooth) {
    throw new Error(distoSupportMessage());
  }
  await disconnectDisto();

  const device = await navigator.bluetooth.requestDevice({
    filters: [
      { namePrefix: "DISTO" },
      { namePrefix: "Disto" },
      { namePrefix: "Leica" },
      { namePrefix: "D2" },
      { services: [DISTO_SERVICE] },
    ],
    optionalServices: [DISTO_SERVICE, 0x180a, 0x180f],
  });

  const onDisconnected = () => {
    session = null;
    handlers.onDisconnect();
  };
  device.addEventListener("gattserverdisconnected", onDisconnected);

  const server = await device.gatt?.connect();
  if (!server) throw new Error("Could not open a Bluetooth link to the DISTO.");

  const service = await server.getPrimaryService(DISTO_SERVICE);
  const distance = await service.getCharacteristic(DISTO_DISTANCE);
  let unitChar: BluetoothRemoteGATTCharacteristic | null = null;
  let command: BluetoothRemoteGATTCharacteristic | null = null;
  try {
    unitChar = await service.getCharacteristic(DISTO_UNIT);
  } catch {
    unitChar = null;
  }
  try {
    command = await service.getCharacteristic(DISTO_COMMAND);
  } catch {
    command = null;
  }

  const emit = async () => {
    const unit = parseUnit(unitChar?.value ?? (unitChar ? await unitChar.readValue() : null));
    const raw = decodeDistance(distance.value);
    if (raw == null) return;
    handlers.onReading({
      raw,
      unit,
      meters: toMeters(raw, unit),
      name: device.name || "DISTO D2",
    });
  };

  distance.addEventListener("characteristicvaluechanged", () => {
    void emit();
  });
  await distance.startNotifications();

  if (unitChar) {
    unitChar.addEventListener("characteristicvaluechanged", () => {
      void emit();
    });
    try {
      await unitChar.startNotifications();
    } catch {
      /* indications may already be on */
    }
  }

  try {
    await distance.readValue();
    await emit();
  } catch {
    /* wait for the next shot */
  }

  session = { device, command, onDisconnected };
  return { name: device.name || "DISTO D2" };
}

export async function triggerDistoMeasure(): Promise<void> {
  if (!session?.command) return;
  await session.command.writeValueWithoutResponse(new Uint8Array([0x67]));
}

export async function disconnectDisto(): Promise<void> {
  if (!session) return;
  const current = session;
  session = null;
  current.device.removeEventListener("gattserverdisconnected", current.onDisconnected);
  try {
    current.device.gatt?.disconnect();
  } catch {
    /* already gone */
  }
}
