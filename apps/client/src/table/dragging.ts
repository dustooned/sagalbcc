// Dragging things on the table (one piece, a multi-selection, markers, notes).
// While *I* drag, positions live here and the 3D objects read them every frame; everyone
// else sees the throttled server updates, smoothed.
import { clampToTable, type Point2 } from '@kitforge/shared-types';
import { store } from '../net/tableStore.ts';
import { screenToTable } from './tablePointer.ts';

export const localDrag = new Map<string, Point2>();

const SEND_EVERY_MS = 50;
const CLICK_SLOP_PX = 4;

export interface DragItem { id: string; x: number; z: number; w?: number; h?: number }

const HIST_WINDOW_MS = 260;
/** How much recent back-and-forth motion (table inches, within HIST_WINDOW_MS) counts as a
 *  shake, vs. just a steady drag across the table. */
const SHAKE_PATH_IN = 3;
const SHAKE_THROTTLE_MS = 170;
/** A release velocity above this (table inches/ms) counts as a flick, not a gentle drop. */
const FLICK_SPEED = 0.012;
const FLICK_SLIDE_MAX_IN = 4;

/** `onClick` fires instead of a drop when the pointer never moved past the slop (a plain tap).
 *  `onRoll` (dice only) fires repeatedly while being shaken — fast back-and-forth motion while
 *  held, not just a steady drag — and once more on release if the release itself was a fast
 *  flick, which also keeps the die sliding a little further along that direction, Tabletop
 *  Simulator-style "toss it across the table." */
export function beginDrag(start: { clientX: number; clientY: number }, list: DragItem[], onClick?: () => void, onRoll?: () => void) {
  const at = screenToTable(start.clientX, start.clientY);
  if (!at || !list.length) return;
  const offsets = list.map(i => ({ id: i.id, dx: i.x - at.x, dz: i.z - at.z, w: i.w, h: i.h }));
  const many = list.length > 1;
  for (const i of list) localDrag.set(i.id, { x: i.x, z: i.z });
  if (many) store.send('grabMany', { ids: list.map(i => i.id) });
  else store.send('grab', { id: list[0].id });

  let moved = false, lastSend = 0, lastRoll = 0;
  const hist: { t: number; x: number; z: number }[] = [{ t: performance.now(), x: at.x, z: at.z }];
  const current = () => offsets.map(o => ({ id: o.id, ...localDrag.get(o.id)! }));

  const onMove = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - start.clientX, ev.clientY - start.clientY) < CLICK_SLOP_PX) return;
    const p = screenToTable(ev.clientX, ev.clientY);
    if (!p) return;
    moved = true;
    for (const o of offsets) localDrag.set(o.id, clampToTable(p.x + o.dx, p.z + o.dz, o.w, o.h));
    const now = performance.now();
    hist.push({ t: now, x: p.x, z: p.z });
    while (hist.length > 1 && now - hist[0].t > HIST_WINDOW_MS) hist.shift();
    if (onRoll) {
      let path = 0;
      for (let i = 1; i < hist.length; i++) path += Math.hypot(hist[i].x - hist[i - 1].x, hist[i].z - hist[i - 1].z);
      if (path > SHAKE_PATH_IN && now - lastRoll > SHAKE_THROTTLE_MS) { lastRoll = now; onRoll(); }
    }
    if (now - lastSend < SEND_EVERY_MS) return;
    lastSend = now;
    if (many) store.send('moveMany', { items: current() });
    else store.send('move', current()[0]);
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('blur', onCancel);
    if (onRoll && hist.length >= 2) {
      const a = hist[0], b = hist[hist.length - 1];
      const dt = Math.max(1, b.t - a.t);
      const vx = (b.x - a.x) / dt, vz = (b.z - a.z) / dt;
      const speed = Math.hypot(vx, vz);
      if (speed > FLICK_SPEED) {
        const slide = Math.min(FLICK_SLIDE_MAX_IN, speed * 140);
        const ux = vx / speed, uz = vz / speed;
        for (const o of offsets) {
          const cur = localDrag.get(o.id)!;
          localDrag.set(o.id, clampToTable(cur.x + ux * slide, cur.z + uz * slide, o.w, o.h));
        }
        onRoll();
      }
    }
    const final = current();
    for (const o of offsets) localDrag.delete(o.id);
    if (many) store.send('dropMany', { items: final });
    else store.send('drop', { ...final[0], snap: moved });
    if (!moved && onClick) onClick();
  };

  // Alt-Tab, a system dialog or a lost touch mid-drag: put things down where they are, so
  // nobody is left looking at "Dustin is moving that" forever.
  const onCancel = () => onUp();

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('blur', onCancel);
}
