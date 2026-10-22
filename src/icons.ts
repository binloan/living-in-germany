import { svg } from './util';

const wrap = (inner: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const paths = {
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6.5a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7H16"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  crosshair: '<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.7-6M4 4v4h4"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="m10 21 2-6-2.5-2.5L11 8l-3 2v3M12 15l3 2v4M13.5 9l2.5 3 3 .5"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  bookmark: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z"/>',
  compare: '<rect x="3.5" y="4" width="7" height="16" rx="1.5"/><rect x="13.5" y="4" width="7" height="16" rx="1.5"/>',
  euro: '<path d="M17 6.5A6.5 6.5 0 1 0 17 17.5M4 10h9M4 14h9"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"/>',
  train: '<rect x="6" y="3.5" width="12" height="13" rx="3"/><path d="M6 11h12M9 20.5l1.5-4M15 20.5l-1.5-4"/><path d="M9.5 14h.01M14.5 14h.01"/>',
  shield: '<path d="M12 3.5 5 6v5.5c0 4.2 2.8 7.6 7 9 4.2-1.4 7-4.8 7-9V6l-7-2.5Z"/><path d="m9 12 2.2 2.2L15 10"/>',
  volumeOff: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4v-5Z"/><path d="m16 9.5 4 5M20 9.5l-4 5"/>',
  building: '<path d="M5 20V5.5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1V20M15 10h3a1 1 0 0 1 1 1v9M3.5 20h17M8.5 8h3M8.5 11.5h3M8.5 15h3"/>',
  users: '<circle cx="9" cy="8.5" r="2.8"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M15.5 6a2.8 2.8 0 0 1 0 5.4M17 14a5 5 0 0 1 3.5 5"/>',
  home: '<path d="m4 11 8-6.5 8 6.5M6 9.5V20h12V9.5M10 20v-5.5h4V20"/>',
  bag: '<path d="M5.5 8h13l-1 12h-11l-1-12ZM9 8V6.5a3 3 0 0 1 6 0V8"/>',
  restaurant: '<path d="M6 3.5v6a2.5 2.5 0 0 0 5 0v-6M8.5 3.5v17"/><path d="M17 20.5V3.5c-2.2 1.2-3.5 4-3.5 7v2.5H17"/>',
  landmark: '<path d="M3.5 9 12 4l8.5 5M5.5 9.5v8M10 9.5v8M14 9.5v8M18.5 9.5v8M3.5 20h17"/>',
} as const;

export type IconName = keyof typeof paths;
export const icon = (name: IconName, cls = 'icon') => svg(wrap(paths[name]), cls);
