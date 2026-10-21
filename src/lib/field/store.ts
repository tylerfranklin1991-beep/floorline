import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { commit, initHistory, redo as redoH, undo as undoH, type History } from "./history";
import {
  convertProperty,
  newProperty,
  removeLevel,
  uid,
  type FieldStairs,
  sanitizeProperty,
  type FieldOpening,
  type FieldProperty,
  type FieldRoom,
  type Units,
} from "./model";

type FieldState = {
  properties: FieldProperty[];
  currentId: string | null;
  /** Undo history for the open property only (not persisted). */
  history: History<FieldProperty> | null;
  selectedRoomId: string | null;
  selectedOpeningId: string | null;
  selectedStairsId: string | null;
  /** Level shown in the editor (not persisted; the first level on open). */
  currentLevelId: string | null;
  createProperty: (name: string, units: Units) => string;
  openProperty: (id: string | null) => void;
  deleteProperty: (id: string) => void;
  importProperty: (value: unknown) => boolean;
  /** Apply a change to the open property as one undoable step. */
  change: (fn: (p: FieldProperty) => FieldProperty) => void;
  /** Live update while dragging; call `change` (or `commitDrag`) when the drag ends. */
  preview: (fn: (p: FieldProperty) => FieldProperty) => void;
  beginDrag: () => void;
  commitDrag: () => void;
  undo: () => void;
  redo: () => void;
  select: (roomId: string | null, openingId?: string | null) => void;
  addRoom: (room: FieldRoom) => void;
  updateRoom: (id: string, patch: Partial<FieldRoom>) => void;
  deleteRoom: (id: string) => void;
  addOpening: (opening: FieldOpening) => void;
  updateOpening: (id: string, patch: Partial<FieldOpening>) => void;
  deleteOpening: (id: string) => void;
  setUnits: (units: Units) => void;
  setLevel: (id: string) => void;
  addLevel: (name: string) => string;
  renameLevel: (id: string, name: string) => void;
  deleteLevel: (id: string) => void;
  selectStairs: (id: string | null) => void;
  addStairs: (stairs: FieldStairs) => void;
  updateStairs: (id: string, patch: Partial<FieldStairs>) => void;
  deleteStairs: (id: string) => void;
};

let dragBase: FieldProperty | null = null;

/** Called when the phone's storage is full and a save could not be written. */
export let onSaveError: (err: unknown) => void = () => {};
export function setOnSaveError(fn: (err: unknown) => void) {
  onSaveError = fn;
}

/** localStorage that reports (instead of throwing from inside set()) when full. */
export const safeStorage = {
  getItem: (k: string) => {
    try {
      return globalThis.localStorage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (k: string, v: string) => {
    try {
      globalThis.localStorage?.setItem(k, v);
    } catch (err) {
      onSaveError(err);
    }
  },
  removeItem: (k: string) => {
    try {
      globalThis.localStorage?.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

/** A property id not already used (importing the same file twice made duplicates). */
export function uniqueId(id: string, taken: Set<string>): string {
  if (!taken.has(id)) return id;
  let n = 1;
  while (taken.has(`${id}-copy${n > 1 ? n : ""}`)) n += 1;
  return `${id}-copy${n > 1 ? n : ""}`;
}

/** Keep the shown level valid after undo/redo removed or restored levels. */
export function validLevel(p: FieldProperty, levelId: string | null): string | null {
  return p.levels.some((l) => l.id === levelId) ? levelId : (p.levels[0]?.id ?? null);
}

function writeBack(state: FieldState, present: FieldProperty) {
  const stamped = { ...present, updatedAt: Date.now() };
  return {
    properties: state.properties.map((p) => (p.id === stamped.id ? stamped : p)),
    stamped,
  };
}

export const useField = create<FieldState>()(
  persist(
    (set, get) => {
      const apply = (next: FieldProperty, mode: "commit" | "preview") => {
        const state = get();
        if (!state.history) return;
        const { properties, stamped } = writeBack(state, next);
        const history =
          mode === "commit"
            ? commit(state.history, stamped)
            : { ...state.history, present: stamped };
        set({ properties, history });
      };
      const current = () => get().history?.present ?? null;
      return {
        properties: [],
        currentId: null,
        history: null,
        selectedRoomId: null,
        selectedOpeningId: null,
        selectedStairsId: null,
        currentLevelId: null,
        createProperty: (name, units) => {
          const p = newProperty(name, units);
          set({
            properties: [p, ...get().properties],
            currentId: p.id,
            history: initHistory(p),
            selectedRoomId: null,
            selectedOpeningId: null,
            selectedStairsId: null,
            currentLevelId: p.levels[0].id,
          });
          return p.id;
        },
        openProperty: (id) => {
          const p = id ? get().properties.find((x) => x.id === id) : null;
          set({
            currentId: p ? p.id : null,
            history: p ? initHistory(p) : null,
            selectedRoomId: null,
            selectedOpeningId: null,
            selectedStairsId: null,
            currentLevelId: p?.levels[0]?.id ?? null,
          });
        },
        deleteProperty: (id) => {
          // Free the full-size photos too (they used to stay in IndexedDB forever).
          const gone = get().properties.find((p) => p.id === id);
          if (gone && typeof indexedDB !== "undefined")
            void import("./photos").then(({ deletePhotoBlob }) =>
              gone.rooms
                .flatMap((r) => r.photos)
                .forEach((ph) => void deletePhotoBlob(ph.id).catch(() => {})),
            );
          set({
            properties: get().properties.filter((p) => p.id !== id),
            ...(get().currentId === id ? { currentId: null, history: null } : {}),
          });
        },
        importProperty: (value) => {
          const p = sanitizeProperty(value);
          if (!p) return false;
          const copy = {
            ...p,
            id: uniqueId(p.id, new Set(get().properties.map((x) => x.id))),
          };
          set({ properties: [copy, ...get().properties] });
          return true;
        },
        change: (fn) => {
          const p = current();
          if (p) apply(fn(p), "commit");
        },
        preview: (fn) => {
          const p = current();
          if (p) apply(fn(p), "preview");
        },
        beginDrag: () => {
          dragBase = current();
        },
        commitDrag: () => {
          const state = get();
          const base = dragBase;
          dragBase = null;
          if (!state.history || !base || base === state.history.present) return;
          const present = state.history.present;
          set({ history: commit({ ...state.history, present: base }, present) });
        },
        undo: () => {
          const h = get().history;
          if (!h) return;
          const next = undoH(h);
          const levelId = validLevel(next.present, get().currentLevelId);
          set({
            history: next,
            properties: writeBack(get(), next.present).properties,
            ...(levelId !== get().currentLevelId
              ? {
                  currentLevelId: levelId,
                  selectedRoomId: null,
                  selectedOpeningId: null,
                  selectedStairsId: null,
                }
              : {}),
          });
        },
        redo: () => {
          const h = get().history;
          if (!h) return;
          const next = redoH(h);
          const levelId = validLevel(next.present, get().currentLevelId);
          set({
            history: next,
            properties: writeBack(get(), next.present).properties,
            ...(levelId !== get().currentLevelId
              ? {
                  currentLevelId: levelId,
                  selectedRoomId: null,
                  selectedOpeningId: null,
                  selectedStairsId: null,
                }
              : {}),
          });
        },
        select: (roomId, openingId = null) =>
          set({ selectedRoomId: roomId, selectedOpeningId: openingId, selectedStairsId: null }),
        addRoom: (room) => {
          const p0 = current();
          const levelId = p0?.levels.some((l) => l.id === get().currentLevelId)
            ? get().currentLevelId!
            : (p0?.levels[0]?.id ?? room.levelId);
          room = { ...room, levelId };
          get().change((p) => ({ ...p, rooms: [...p.rooms, room] }));
          set({ selectedRoomId: room.id, selectedOpeningId: null });
        },
        updateRoom: (id, patch) =>
          get().change((p) => ({
            ...p,
            rooms: p.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)),
          })),
        deleteRoom: (id) => {
          get().change((p) => ({
            ...p,
            rooms: p.rooms.filter((r) => r.id !== id),
            openings: p.openings.filter((o) => o.roomId !== id),
          }));
          set({ selectedRoomId: null, selectedOpeningId: null });
        },
        addOpening: (opening) => {
          get().change((p) => ({ ...p, openings: [...p.openings, opening] }));
          set({ selectedOpeningId: opening.id });
        },
        updateOpening: (id, patch) =>
          get().change((p) => ({
            ...p,
            openings: p.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)),
          })),
        deleteOpening: (id) => {
          get().change((p) => ({ ...p, openings: p.openings.filter((o) => o.id !== id) }));
          set({ selectedOpeningId: null });
        },
        setUnits: (units) => get().change((p) => convertProperty(p, units)),
        setLevel: (id) =>
          set({
            currentLevelId: id,
            selectedRoomId: null,
            selectedOpeningId: null,
            selectedStairsId: null,
          }),
        addLevel: (name) => {
          const id = uid("level");
          get().change((p) => ({
            ...p,
            levels: [...p.levels, { id, name: name.trim() || "Level" }],
          }));
          get().setLevel(id);
          return id;
        },
        renameLevel: (id, name) =>
          get().change((p) => ({
            ...p,
            levels: p.levels.map((l) => (l.id === id ? { ...l, name: name.trim() || l.name } : l)),
          })),
        deleteLevel: (id) => {
          get().change((p) => removeLevel(p, id));
          const p = current();
          if (p && get().currentLevelId === id) get().setLevel(p.levels[0].id);
        },
        selectStairs: (id) =>
          set({ selectedStairsId: id, selectedRoomId: null, selectedOpeningId: null }),
        addStairs: (stairs) => {
          get().change((p) => ({ ...p, stairs: [...p.stairs, stairs] }));
          get().selectStairs(stairs.id);
        },
        updateStairs: (id, patch) =>
          get().change((p) => ({
            ...p,
            stairs: p.stairs.map((x) => (x.id === id ? { ...x, ...patch } : x)),
          })),
        deleteStairs: (id) => {
          get().change((p) => ({ ...p, stairs: p.stairs.filter((x) => x.id !== id) }));
          set({ selectedStairsId: null });
        },
      };
    },
    {
      name: "floorline-field-v1",
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ properties: s.properties, currentId: s.currentId }),
      merge: (persisted, currentState) => {
        const data = (persisted ?? {}) as Partial<FieldState>;
        const properties = Array.isArray(data.properties)
          ? data.properties.map(sanitizeProperty).filter((p): p is FieldProperty => Boolean(p))
          : [];
        const open = properties.find((p) => p.id === data.currentId) ?? null;
        return {
          ...currentState,
          properties,
          currentId: open?.id ?? null,
          history: open ? initHistory(open) : null,
          currentLevelId: open?.levels[0]?.id ?? null,
        };
      },
    },
  ),
);

export function useCurrentProperty(): FieldProperty | null {
  return useField((s) => s.history?.present ?? null);
}
