import { create } from "zustand";
import { persist } from "zustand/middleware";
import { convertPlan, fromMeters, measureFootprint } from "./format";
import { alignNorthArrow } from "./geo";
import { SAMPLE_PLAN } from "./sample";
import type { FloorPlan, Furniture, PlanLayers, PlanStyle, Room, SiteFix, Units } from "./types";
import { DEFAULT_LAYERS } from "./types";

export type StudioStatus = "idle" | "preparing" | "analyzing" | "error";
export type AppView = "home" | "studio";

const MAX_SAVED = 12;

function isUsablePlan(value: unknown): value is FloorPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as FloorPlan;
  if (typeof plan.title !== "string" || !Array.isArray(plan.rooms) || plan.rooms.length === 0) return false;
  return plan.rooms.every(
    (room) =>
      room &&
      typeof room.x === "number" &&
      typeof room.y === "number" &&
      typeof room.w === "number" &&
      typeof room.h === "number",
  );
}

function normalizePlan(value: unknown): FloorPlan | null {
  if (!isUsablePlan(value)) return null;
  return {
    ...value,
    openings: Array.isArray(value.openings) ? value.openings : [],
    furniture: Array.isArray(value.furniture) ? value.furniture : [],
    notes: typeof value.notes === "string" ? value.notes : "",
    overallWidth: typeof value.overallWidth === "number" ? value.overallWidth : 20,
    overallDepth: typeof value.overallDepth === "number" ? value.overallDepth : 16,
    northAngle: typeof value.northAngle === "number" ? value.northAngle : 0,
  };
}

function normalizeLayers(value: unknown): PlanLayers {
  const incoming = value && typeof value === "object" ? (value as Partial<PlanLayers>) : {};
  return {
    grid: incoming.grid ?? DEFAULT_LAYERS.grid,
    labels: incoming.labels ?? DEFAULT_LAYERS.labels,
    dimensions: incoming.dimensions ?? DEFAULT_LAYERS.dimensions,
    furniture: incoming.furniture ?? DEFAULT_LAYERS.furniture,
    openings: incoming.openings ?? DEFAULT_LAYERS.openings,
  };
}

type PlanState = {
  view: AppView;
  plan: FloorPlan | null;
  saved: FloorPlan[];
  selectedRoomId: string | null;
  selectedFurnitureId: string | null;
  style: PlanStyle;
  layers: PlanLayers;
  unitsPref: Units;
  status: StudioStatus;
  statusDetail: string;
  error: string | null;
  hydrated: boolean;
  surveyFrames: string[];
  sketchNonce: number;
  workId: number;
  distoStatus: "off" | "connecting" | "connected" | "unsupported";
  distoName: string | null;
  distoError: string | null;
  distoMeters: number | null;
  distoAt: number | null;
  setHydrated: (value: boolean) => void;
  setView: (view: AppView) => void;
  openSample: () => void;
  setPlan: (plan: FloorPlan) => void;
  saveCurrent: () => void;
  loadSaved: (id: string) => void;
  deleteSaved: (id: string) => void;
  selectRoom: (id: string | null) => void;
  selectFurniture: (id: string | null) => void;
  setStyle: (style: PlanStyle) => void;
  toggleLayer: (key: keyof PlanLayers) => void;
  setUnitsPref: (units: Units) => void;
  setPlanUnits: (units: Units) => void;
  updateRoom: (id: string, patch: Partial<Pick<Room, "name" | "type" | "w" | "h">>) => void;
  updateTitle: (title: string) => void;
  moveFurniture: (id: string, x: number, y: number) => void;
  rotateFurniture: (id: string, delta: number) => void;
  setFurniture: (items: Furniture[]) => void;
  setStatus: (status: StudioStatus, detail?: string) => void;
  setError: (error: string | null) => void;
  setSurveyFrames: (frames: string[]) => void;
  patchPlan: (patch: Partial<FloorPlan>) => void;
  setSite: (site: SiteFix | null) => void;
  alignSheetNorth: () => void;
  replaySketch: () => void;
  beginWork: (status: StudioStatus, detail?: string) => number;
  isCurrentWork: (id: number) => boolean;
  cancelWork: () => void;
  setDisto: (patch: Partial<Pick<PlanState, "distoStatus" | "distoName" | "distoError" | "distoMeters" | "distoAt">>) => void;
  applyDisto: (axis: "w" | "h") => void;
  reset: () => void;
};

export const usePlanStore = create<PlanState>()(
  persist(
    (set, get) => ({
      view: "home",
      plan: null,
      saved: [],
      selectedRoomId: null,
      selectedFurnitureId: null,
      style: "sheet",
      layers: DEFAULT_LAYERS,
      unitsPref: "ft",
      status: "idle",
      statusDetail: "",
      error: null,
      hydrated: false,
      surveyFrames: [],
      sketchNonce: 0,
      workId: 0,
      distoStatus: "off",
      distoName: null,
      distoError: null,
      distoMeters: null,
      distoAt: null,
      setHydrated: (value) => set({ hydrated: value }),
      setView: (view) => set({ view, status: "idle", statusDetail: "", error: null }),
      openSample: () =>
        set({
          view: "studio",
          plan: { ...SAMPLE_PLAN, createdAt: Date.now() },
          selectedRoomId: null,
          selectedFurnitureId: null,
          style: "sketch",
          status: "idle",
          statusDetail: "",
          error: null,
          surveyFrames: [],
          sketchNonce: get().sketchNonce + 1,
        }),
      setPlan: (plan) =>
        set({
          view: "studio",
          plan,
          selectedRoomId: null,
          selectedFurnitureId: null,
          style: "sketch",
          status: "idle",
          statusDetail: "",
          error: null,
          surveyFrames: [],
          sketchNonce: get().sketchNonce + 1,
        }),
      saveCurrent: () => {
        const { plan, saved } = get();
        if (!plan) return;
        const next = [plan, ...saved.filter((item) => item.id !== plan.id)].slice(0, MAX_SAVED);
        set({ saved: next });
      },
      loadSaved: (id) => {
        const found = get().saved.find((item) => item.id === id);
        if (!found) return;
        set({
          view: "studio",
          plan: found,
          selectedRoomId: null,
          selectedFurnitureId: null,
          status: "idle",
          statusDetail: "",
          error: null,
          sketchNonce: get().sketchNonce + 1,
        });
      },
      deleteSaved: (id) => set({ saved: get().saved.filter((item) => item.id !== id) }),
      selectRoom: (id) => set({ selectedRoomId: id, selectedFurnitureId: null }),
      selectFurniture: (id) => set({ selectedFurnitureId: id, selectedRoomId: null }),
      setStyle: (style) => set({ style }),
      toggleLayer: (key) =>
        set({
          layers: { ...get().layers, [key]: !get().layers[key] },
        }),
      setUnitsPref: (units) => set({ unitsPref: units }),
      setPlanUnits: (units) => {
        const plan = get().plan;
        set({ unitsPref: units });
        if (!plan || plan.units === units) return;
        set({ plan: convertPlan(plan, units) });
      },
      updateRoom: (id, patch) => {
        const plan = get().plan;
        if (!plan) return;
        const rooms = plan.rooms.map((room) => {
          if (room.id !== id) return room;
          const next = { ...room, ...patch };
          if (typeof patch.w === "number") next.w = Math.max(2.5, patch.w);
          if (typeof patch.h === "number") next.h = Math.max(2.5, patch.h);
          return next;
        });
        set({
          plan: {
            ...plan,
            rooms,
            ...measureFootprint(rooms, plan.furniture),
          },
        });
      },
      updateTitle: (title) => {
        const plan = get().plan;
        if (!plan) return;
        set({ plan: { ...plan, title } });
      },
      moveFurniture: (id, x, y) => {
        const plan = get().plan;
        if (!plan) return;
        const furniture = plan.furniture.map((item) => (item.id === id ? { ...item, x, y } : item));
        set({
          plan: {
            ...plan,
            furniture,
            ...measureFootprint(plan.rooms, furniture),
          },
        });
      },
      rotateFurniture: (id, delta) => {
        const plan = get().plan;
        if (!plan) return;
        set({
          plan: {
            ...plan,
            furniture: plan.furniture.map((item) =>
              item.id === id ? { ...item, rotation: (((item.rotation + delta) % 360) + 360) % 360 } : item,
            ),
          },
        });
      },
      setFurniture: (items) => {
        const plan = get().plan;
        if (!plan) return;
        set({
          plan: {
            ...plan,
            furniture: items,
            ...measureFootprint(plan.rooms, items),
          },
        });
      },
      setStatus: (status, detail = "") => set({ status, statusDetail: detail, error: status === "error" ? get().error : null }),
      setError: (error) => set({ error, status: error ? "error" : get().status }),
      setSurveyFrames: (surveyFrames) => set({ surveyFrames }),
      patchPlan: (patch) => {
        const plan = get().plan;
        if (!plan) return;
        set({ plan: { ...plan, ...patch } });
      },
      setSite: (site) => {
        const plan = get().plan;
        if (!plan) return;
        set({ plan: alignNorthArrow({ ...plan, site }) });
      },
      alignSheetNorth: () => {
        const plan = get().plan;
        if (!plan) return;
        set({ plan: alignNorthArrow(plan) });
      },
      replaySketch: () => set({ sketchNonce: get().sketchNonce + 1 }),
      beginWork: (status, detail = "") => {
        const workId = get().workId + 1;
        set({ workId, status, statusDetail: detail, error: null });
        return workId;
      },
      isCurrentWork: (id) => get().workId === id,
      cancelWork: () =>
        set({
          workId: get().workId + 1,
          status: "idle",
          statusDetail: "",
          error: null,
          surveyFrames: [],
        }),
      setDisto: (patch) => set(patch),
      applyDisto: (axis) => {
        const { plan, selectedRoomId, distoMeters } = get();
        if (!plan || !selectedRoomId || distoMeters == null) return;
        const value = Math.max(1, fromMeters(distoMeters, plan.units));
        get().updateRoom(selectedRoomId, { [axis]: value });
      },
      reset: () =>
        set({
          view: "home",
          selectedRoomId: null,
          selectedFurnitureId: null,
          status: "idle",
          statusDetail: "",
          error: null,
          surveyFrames: [],
        }),
    }),
    {
      name: "floorline-v2",
      partialize: (state) => ({
        plan: state.plan,
        saved: state.saved,
        style: state.style,
        layers: state.layers,
        unitsPref: state.unitsPref,
      }),
      merge: (persisted, current) => {
        const data = (persisted ?? {}) as Partial<PlanState>;
        const plan = normalizePlan(data.plan);
        const saved = Array.isArray(data.saved)
          ? data.saved.map(normalizePlan).filter((item): item is FloorPlan => Boolean(item))
          : current.saved;
        const style =
          data.style === "sheet" || data.style === "blueprint" || data.style === "ink" || data.style === "sketch"
            ? data.style
            : current.style;
        const layers = normalizeLayers(data.layers);
        const unitsPref = data.unitsPref === "m" || data.unitsPref === "ft" ? data.unitsPref : current.unitsPref;
        const userMoved = current.view !== "home" || current.status !== "idle" || current.workId > 0;
        if (userMoved) {
          return {
            ...current,
            saved,
            unitsPref,
          };
        }
        return {
          ...current,
          plan,
          saved,
          style,
          layers,
          unitsPref,
          status: "idle",
          statusDetail: "",
          error: null,
          view: "home",
          surveyFrames: [],
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
        if (typeof document !== "undefined") {
          document.body.style.pointerEvents = "";
          document.documentElement.style.pointerEvents = "";
        }
      },
    },
  ),
);
