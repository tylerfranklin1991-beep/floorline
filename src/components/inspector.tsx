import { useEffect, useState } from "react";
import { formatLength, fromMeters, roomTypeLabel } from "@/lib/floorplan/format";
import { cardinalLabel, formatAccuracy, formatCoords, osmTileUrl, requestGpsFix, siteFromFix } from "@/lib/floorplan/geo";
import { reverseSite } from "@/lib/floorplan/site";
import { usePlanStore } from "@/lib/floorplan/store";
import { ROOM_TYPES, type RoomType, type Units } from "@/lib/floorplan/types";
import { Button } from "./ui/button";
import { connectDisto, disconnectDisto, distoSupportMessage, isDistoSupported, triggerDistoMeasure } from "@/lib/floorplan/disto";
import { toast } from "sonner";

function DimField({
  label,
  value,
  units,
  onCommit,
}: {
  label: string;
  value: number;
  units: Units;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);

  return (
    <label className="block text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
      {label}
      <span className="mt-2 flex h-11 items-center rounded-md border border-border bg-background px-3">
        <input
          value={text}
          inputMode="decimal"
          onChange={(event) => setText(event.target.value)}
          onBlur={() => {
            const next = Number(text);
            if (Number.isFinite(next) && next >= 2.5) onCommit(Math.round(next * 100) / 100);
            else setText(String(value));
          }}
          className="h-full w-full bg-transparent text-sm text-foreground outline-none"
        />
        <span className="text-xs text-muted-foreground">{units}</span>
      </span>
    </label>
  );
}

export function Inspector() {
  const plan = usePlanStore((s) => s.plan);
  const selectedRoomId = usePlanStore((s) => s.selectedRoomId);
  const selectedFurnitureId = usePlanStore((s) => s.selectedFurnitureId);
  const updateRoom = usePlanStore((s) => s.updateRoom);
  const updateTitle = usePlanStore((s) => s.updateTitle);
  const setFurniture = usePlanStore((s) => s.setFurniture);
  const rotateFurniture = usePlanStore((s) => s.rotateFurniture);
  const selectRoom = usePlanStore((s) => s.selectRoom);
  const setPlanUnits = usePlanStore((s) => s.setPlanUnits);
  const setSite = usePlanStore((s) => s.setSite);
  const alignSheetNorth = usePlanStore((s) => s.alignSheetNorth);
  const distoStatus = usePlanStore((s) => s.distoStatus);
  const distoName = usePlanStore((s) => s.distoName);
  const distoMeters = usePlanStore((s) => s.distoMeters);
  const distoError = usePlanStore((s) => s.distoError);
  const setDisto = usePlanStore((s) => s.setDisto);
  const applyDisto = usePlanStore((s) => s.applyDisto);
  const [pinning, setPinning] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  if (!plan) return null;

  const room = plan.rooms.find((entry) => entry.id === selectedRoomId);
  const furniture = plan.furniture.find((entry) => entry.id === selectedFurnitureId);
  const area = plan.rooms.reduce((sum, entry) => sum + entry.w * entry.h, 0);
  const areaLabel = `${Math.round(area)} ${plan.units === "m" ? "m²" : "sf"}`;

  return (
    <aside className="flex min-h-0 flex-col gap-5 p-4">
      <div>
        <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Sheet</p>
        <input
          value={plan.title}
          onChange={(event) => updateTitle(event.target.value)}
          aria-label="Sheet title"
          className="mt-2 w-full rounded-md bg-transparent font-display text-2xl leading-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        />
        <p className="mt-2 text-sm leading-relaxed text-pretty text-muted-foreground">
          {plan.rooms.length} rooms · {formatLength(plan.overallWidth, plan.units)} ×{" "}
          {formatLength(plan.overallDepth, plan.units)} · {areaLabel}
        </p>
      </div>

      <div className="flex rounded-lg bg-secondary p-1">
        {(["ft", "m"] as Units[]).map((unit) => (
          <button
            key={unit}
            type="button"
            onClick={() => setPlanUnits(unit)}
            className={`h-11 flex-1 rounded-md text-sm ${
              plan.units === unit ? "bg-background text-foreground" : "text-muted-foreground"
            }`}
          >
            {unit === "ft" ? "Feet" : "Metres"}
          </button>
        ))}
      </div>

      <div>
        <p className="mb-2 text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Leica DISTO D2</p>
        <div className="rounded-xl border border-border p-3">
          {distoStatus === "connected" ? (
            <>
              <p className="text-sm text-foreground">{distoName || "DISTO D2"}</p>
              <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                {distoMeters != null
                  ? `Last shot ${formatLength(fromMeters(distoMeters, plan.units), plan.units)}`
                  : "Fire the laser to send a length"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void triggerDistoMeasure()}>
                  Measure
                </Button>
                {room && distoMeters != null && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="paper"
                      onClick={() => {
                        applyDisto("w");
                        toast("Width updated from DISTO");
                      }}
                    >
                      Width
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="paper"
                      onClick={() => {
                        applyDisto("h");
                        toast("Depth updated from DISTO");
                      }}
                    >
                      Depth
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void disconnectDisto();
                    setDisto({ distoStatus: "off", distoName: null });
                  }}
                >
                  Disconnect
                </Button>
              </div>
              {room ? null : (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Select a room to apply the shot as width or depth.</p>
              )}
            </>
          ) : (
            <>
              <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
                {distoError ||
                  (isDistoSupported()
                    ? "Hold the DISTO Bluetooth key for two seconds, then connect. Shots land as room widths and depths."
                    : distoSupportMessage())}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                disabled={distoStatus === "connecting"}
                onClick={async () => {
                  if (!isDistoSupported()) {
                    setDisto({ distoStatus: "unsupported", distoError: distoSupportMessage() });
                    toast(distoSupportMessage());
                    return;
                  }
                  setDisto({ distoStatus: "connecting", distoError: null });
                  try {
                    const { name } = await connectDisto({
                      onReading: (reading) => {
                        setDisto({
                          distoStatus: "connected",
                          distoName: reading.name,
                          distoMeters: reading.meters,
                          distoAt: Date.now(),
                          distoError: null,
                        });
                        toast(`DISTO ${formatLength(fromMeters(reading.meters, plan.units), plan.units)}`);
                      },
                      onDisconnect: () => setDisto({ distoStatus: "off", distoName: null }),
                    });
                    setDisto({ distoStatus: "connected", distoName: name, distoError: null });
                    toast(`Connected to ${name}`);
                  } catch (err) {
                    if (err instanceof Error && err.name === "NotFoundError") {
                      setDisto({ distoStatus: "off", distoError: null });
                      return;
                    }
                    const message = err instanceof Error ? err.message : "Could not reach the DISTO.";
                    setDisto({ distoStatus: "off", distoError: message });
                    toast(message);
                  }
                }}
              >
                {distoStatus === "connecting" ? "Connecting…" : "Connect DISTO D2"}
              </Button>
            </>
          )}
        </div>
      </div>

      {plan.notes ? (
        <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{plan.notes}</p>
      ) : null}

      <div>
        <p className="mb-2 text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Site</p>
        {plan.site ? (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="site-map">
              <img
                src={osmTileUrl(plan.site.lat, plan.site.lng)}
                alt=""
                className="plain-image"
                crossOrigin="anonymous"
              />
              <span className="site-map-pin" />
            </div>
            <div className="space-y-1 p-3">
              <p className="text-sm text-foreground">{plan.site.address || formatCoords(plan.site.lat, plan.site.lng)}</p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {formatCoords(plan.site.lat, plan.site.lng)} · {formatAccuracy(plan.site.accuracy)}
                {plan.site.heading != null ? ` · facing ${Math.round(plan.site.heading)}° ${cardinalLabel(plan.site.heading)}` : ""}
              </p>
              <p className="text-xs text-muted-foreground">North arrow {Math.round(plan.northAngle)}°</p>
              <div className="flex gap-2 pt-2">
                <Button type="button" size="sm" variant="outline" onClick={() => alignSheetNorth()}>
                  Align north
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSite(null)}>
                  Clear
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border p-3">
            <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
              Pin this survey to orient the sheet and stamp the title block. Location stays on this device.
            </p>
            {pinError && <p className="mt-2 text-xs text-foreground">{pinError}</p>}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              disabled={pinning}
              onClick={async () => {
                setPinning(true);
                setPinError(null);
                const coords = await requestGpsFix();
                if (!coords) {
                  setPinError("Location was blocked or unavailable.");
                  setPinning(false);
                  return;
                }
                const geo = await reverseSite({ data: { lat: coords.lat, lng: coords.lng } });
                setSite(siteFromFix(coords, null, geo.address));
                setPinning(false);
              }}
            >
              {pinning ? "Locating…" : "Use my location"}
            </Button>
          </div>
        )}
      </div>

      {plan.sourceKind !== "sample" && (
        <p className="text-xs tabular-nums text-muted-foreground">
          Confidence {Math.round(plan.confidence * 100)}% · {plan.sourceCount} source
          {plan.sourceCount === 1 ? "" : "s"}
        </p>
      )}

      <div>
        <p className="mb-2 text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Rooms</p>
        <ul className="flex flex-col gap-1">
          {plan.rooms.map((entry) => {
            const active = entry.id === selectedRoomId;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => selectRoom(active ? null : entry.id)}
                  className={`flex h-11 w-full items-center justify-between rounded-lg px-3 text-left text-sm transition-colors duration-150 ${
                    active
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                  }`}
                >
                  <span>{entry.name}</span>
                  <span className="font-mono text-xs tabular-nums">
                    {formatLength(entry.w, plan.units)} × {formatLength(entry.h, plan.units)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {room && (
        <div className="rounded-xl bg-secondary/70 p-3">
          <label className="block text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
            Room name
            <input
              value={room.name}
              onChange={(event) => updateRoom(room.id, { name: event.target.value })}
              className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            />
          </label>
          <label className="mt-3 block text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
            Type
            <select
              value={room.type}
              onChange={(event) => updateRoom(room.id, { type: event.target.value as RoomType })}
              className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              {ROOM_TYPES.map((type) => (
                <option key={type} value={type}>
                  {roomTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <DimField
              label="Width"
              value={room.w}
              units={plan.units}
              onCommit={(w) => updateRoom(room.id, { w })}
            />
            <DimField
              label="Depth"
              value={room.h}
              units={plan.units}
              onCommit={(h) => updateRoom(room.id, { h })}
            />
          </div>
        </div>
      )}

      {furniture && (
        <div className="rounded-xl bg-secondary/70 p-3">
          <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Object</p>
          <p className="mt-2 text-sm text-foreground">{furniture.label}</p>
          <p className="mt-1 text-xs text-muted-foreground">Drag on the sheet to reposition.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => rotateFurniture(furniture.id, 90)}>
              Rotate 90°
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFurniture(plan.furniture.filter((item) => item.id !== furniture.id))}
            >
              Remove object
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}
