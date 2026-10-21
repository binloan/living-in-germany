import { icon } from '../icons';
import type { Photo } from '../types';
import { h } from '../util';

/** Wikimedia serves ready-made thumbnails at fixed widths only (120, 250, 500, 960 ...; 160 or 320 answer 400); the stored url is the 960 px one. */
export const wikiWidth = (u: string, w: number) => u.replace(/\/\d+px-/, `/${w}px-`);

/** Full-screen viewer for the photos of an area: swipe sideways, the credit of the shown photo under it. */
export function openGallery(zoneName: string, photos: Photo[], start = 0) {
  const n = photos.length;
  const count = h('span.gl-count');
  const credit = h('a.gl-credit', { target: '_blank', rel: 'noopener' }) as HTMLAnchorElement;
  const track = h('div.gl-track', { tabindex: 0, role: 'group', 'aria-label': `Photos of ${zoneName}` },
    ...photos.map((p) => h('figure.gl-slide', null, h('img', {
      src: p.u, srcset: `${wikiWidth(p.u, 500)} 500w, ${p.u} 960w`, sizes: '100vw',
      width: p.w, height: p.h, alt: `${zoneName}, photo by ${p.by}`, decoding: 'async', draggable: false,
    })))) as HTMLElement;
  const close = h('button.icon-btn.gl-close', { type: 'button', 'aria-label': 'Close photos', onclick: () => dlg.close() }, icon('x'));
  const dlg = h('dialog.gallery', { 'aria-label': `Photos of ${zoneName}` },
    h('header', null, h('div', null, h('b', null, zoneName), count), close),
    track,
    h('footer', null, credit)) as HTMLDialogElement;

  const at = () => Math.min(n - 1, Math.max(0, Math.round(track.scrollLeft / Math.max(1, track.clientWidth))));
  const show = (k: number) => {
    const p = photos[k];
    count.textContent = n > 1 ? `${k + 1} / ${n}` : '';
    credit.textContent = `Photo: ${p.by}, ${p.lic}`;
    credit.href = p.page;
  };
  const go = (k: number) => track.scrollTo({ left: Math.min(n - 1, Math.max(0, k)) * track.clientWidth, behavior: 'smooth' });
  track.addEventListener('scroll', () => show(at()), { passive: true });
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { go(at() + 1); e.preventDefault(); } else if (e.key === 'ArrowLeft') { go(at() - 1); e.preventDefault(); }
  });
  dlg.addEventListener('close', () => dlg.remove());

  document.body.append(dlg);
  dlg.showModal();
  track.scrollLeft = start * track.clientWidth;
  show(start);
  track.focus({ preventScroll: true });
}
