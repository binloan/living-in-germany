import { h } from '../util';

/**
 * The handle at the top of a phone bottom sheet. Pulling it down drags the sheet along and closes it once let go far enough (or
 * fast enough); a tap closes it too, so it stays a plain button for keyboards and screen readers. The CSS shows it below 900 px only,
 * where it takes the place of the sheet's close button.
 */
export function sheetHandle(sheet: () => HTMLElement, close: () => void) {
  let drag: { y: number; t: number; id: number } | null = null;
  let dy = 0;
  let moved = false;
  let timer = 0;
  let leaving = false; // the sheet is sliding out: it closes when the timer fires

  const settle = (away: boolean) => {
    const el = sheet();
    el.style.transition = 'transform 0.16s ease-out';
    el.style.transform = away ? `translateY(${el.offsetHeight + 160}px)` : '';
    window.clearTimeout(timer);
    leaving = away;
    timer = window.setTimeout(() => {
      leaving = false;
      el.style.transition = '';
      el.style.transform = '';
      if (away) close();
    }, 170);
  };

  const grip = h('button.sheet-handle', {
    type: 'button', 'aria-label': 'Close',
    onclick: () => { if (!moved) close(); },
  }, h('span')) as HTMLButtonElement;

  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (leaving) return;
    // a new touch cancels a pending spring-back, so its timer cannot reset the sheet under the finger
    window.clearTimeout(timer);
    drag = { y: e.clientY, t: e.timeStamp, id: e.pointerId };
    dy = 0;
    moved = false;
    try { grip.setPointerCapture(e.pointerId); } catch { /* the gesture then simply ends without capture */ }
    sheet().style.transition = 'none';
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    dy = Math.max(0, e.clientY - drag.y);
    if (dy > 6) moved = true;
    sheet().style.transform = dy ? `translateY(${dy}px)` : '';
  });
  const release = (e: PointerEvent) => {
    if (!drag) return;
    const fast = dy / Math.max(1, e.timeStamp - drag.t) > 0.5; // px per ms
    drag = null;
    if (!moved) { sheet().style.transition = ''; return; }
    settle(e.type === 'pointerup' && (dy > 90 || (fast && dy > 30)));
    // the click that follows a drag must not count as a tap
    window.setTimeout(() => { moved = false; }, 0);
  };
  grip.addEventListener('pointerup', release);
  grip.addEventListener('pointercancel', release);
  grip.addEventListener('lostpointercapture', release); // never leave a gesture half-open
  return grip;
}
