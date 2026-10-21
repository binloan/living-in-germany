import { createPrice, deletePrice, listPrices, updatePrice } from './api';
import { store } from './store';
import type { PricePoint } from './types';

const POLL_MS = 60_000;

const same = (a: PricePoint[], b: PricePoint[]) => JSON.stringify(a) === JSON.stringify(b);
const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

/**
 * Rents are shared by every visitor and live on the server. The list is fetched on start, when the tab
 * comes back into view and every minute, so other people's prices show up without a reload.
 */
export const prices = {
  async load() {
    try {
      const list = await listPrices();
      if (!same(list, store.t.prices)) store.setT({ prices: list });
    } catch { /* offline or server down: keep what is shown */ }
  },

  start() {
    void prices.load();
    setInterval(() => { if (!document.hidden) void prices.load(); }, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void prices.load(); });
  },

  /** Each returns an error text for the user, or null when it worked. */
  async add(p: { lat: number; lon: number }, value: number) {
    try {
      const created = await createPrice({ ...p, value });
      store.setT({ prices: [...store.t.prices.filter((q) => q.id !== created.id), created] });
      return null;
    } catch (e) { return message(e); }
  },

  async edit(id: string, value: number) {
    try {
      const updated = await updatePrice(id, value);
      store.setT({ prices: store.t.prices.map((q) => (q.id === id ? updated : q)) });
      return null;
    } catch (e) { void prices.load(); return message(e); }
  },

  async remove(id: string) {
    try {
      await deletePrice(id);
      store.setT({ prices: store.t.prices.filter((q) => q.id !== id) });
      return null;
    } catch (e) { void prices.load(); return message(e); }
  },
};
