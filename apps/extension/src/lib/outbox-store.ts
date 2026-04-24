import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { OutboxRecord } from "./outbox-db";

export interface OutboxStoreState {
  items: OutboxRecord[];
  hydrate: (items: OutboxRecord[]) => void;
  upsert: (record: OutboxRecord) => void;
  remove: (id: string) => void;
  clear: () => void;
}

function sortItems(items: OutboxRecord[]): OutboxRecord[] {
  // Oldest first so the UI shows items in post order. Ties broken by id for
  // determinism in tests.
  return [...items].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id.localeCompare(b.id);
  });
}

export const outboxStore = createStore<OutboxStoreState>((set) => ({
  items: [],
  hydrate: (items) => set({ items: sortItems(items) }),
  upsert: (record) =>
    set((state) => {
      const idx = state.items.findIndex((r) => r.id === record.id);
      const next = [...state.items];
      if (idx >= 0) next[idx] = record;
      else next.push(record);
      return { items: sortItems(next) };
    }),
  remove: (id) => set((state) => ({ items: state.items.filter((r) => r.id !== id) })),
  clear: () => set({ items: [] }),
}));

export function useOutbox<T>(selector: (state: OutboxStoreState) => T): T {
  return useStore(outboxStore, selector);
}

export interface OutboxCounts {
  pending: number;
  error: number;
}

export function countsOf(items: readonly OutboxRecord[]): OutboxCounts {
  let pending = 0;
  let error = 0;
  for (const item of items) {
    if (item.state === "pending") pending++;
    else if (item.state === "error") error++;
  }
  return { pending, error };
}
