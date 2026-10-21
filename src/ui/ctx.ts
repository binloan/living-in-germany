import type { Dataset } from '../data';
import type { Engine } from '../engine';
import type { MapView } from '../map';
import type { Routes } from '../routes';

export interface Ctx {
  ds: Dataset;
  engine: Engine;
  view: MapView;
  routes: Routes;
  /** Select a spot, optionally flying the camera there. */
  select(lat: number, lon: number, fly?: boolean): void;
  addCommute(p: { name: string; lat: number; lon: number }): void;
  /** Put an average rent on the map. Returns an error text, or null on success. */
  addPrice(p: { lat: number; lon: number }, value: number): Promise<string | null>;
  isBookmarked(lat: number, lon: number): boolean;
  /** Save a spot for comparison, or drop it when already saved. Returns an error text when it cannot be added. */
  toggleBookmark(lat: number, lon: number): string | null;
}
