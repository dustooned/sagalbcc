// Dragging things on the table (one piece, a multi-selection, markers, notes).
// While *I* drag, positions live here and the 3D objects read them every frame; everyone
// else sees the throttled server updates, smoothed.
import { clampToTable, type Point2 } from '@kitforge/shared-types';
import { store } from '../net/tableStore.ts';
import { screenToTable } from './tablePointer.ts';

export const localDrag = new Map<string, Point2>();
/** Ids sliding on their own after a flick — on the felt, not held up in the hand. */
export const gliding = new Set<string>();

let active = 0;
/** True while this player is holding something or it's still gliding from a throw. The camera
 *  ignores touch gestures meanwhile, so a second finger can't orbit the table mid-throw. */
export const isDragging = () => active > 0;

const SEND_EVERY_MS = 50;
const CLICK_SLOP_PX = 4;

export interface DragItem { id: string; x: number; z: number; w?: number; h?: number }

// Gestures are judged in SCREEN pixels — what the hand actually did — so they feel the same at
// any camera zoom. The glide itself runs in table inches, so the die leaves the hand at exactly
// the speed it was following the hand.
const HIST_WINDOW_MS = 260;
/** Back-and-forth hand travel (px within HIST_WINDOW_MS) that counts as shaking, not dragging. */
const SHAKE_PATH_PX = 260;
/** A shake also needs direction changes — a fast straight drag isn't a shake. */
const SHAKE_REVERSALS = 2;
const SHAKE_THROTTLE_MS = 150;
/** Hand speed at release (px/ms) that counts as a throw rather than setting it down. */
const FLICK_PX_PER_MS = 0.55;
/** Velocity comes from only the last moments before release — what the hand did as it let go. */
const RELEASE_WINDOW_MS = 70;
const MAX_GLIDE_SPEED = 0.06;
/** Per-ms friction: a hard throw slides for roughly half a second, then settles. */
const GLIDE_FRICTION = 0.0055;
const GLIDE_STOP_SPEED = 0.001;
const RIM_BOUNCE = 0.45;

interface Sample { t: number; sx: number; sy: number; x: number; z: number }

function releaseVelocity(hist: Sample[]) {
  if (hist.length < 2) return null;
  const end = hist[hist.length - 1];
  // Held still at the end of the drag = setting it down gently, not a throw.
  if (performance.now() - end.t > RELEASE_WINDOW_MS) return null;
  let start = hist[0];
  for (const h of hist) if (end.t - h.t <= RELEASE_WINDOW_MS) { start = h; break; }
  const dt = Math.max(8, end.t - start.t);
  return {
    screen: Math.hypot(end.sx - start.sx, end.sy - start.sy) / dt,
    x: (end.x - start.x) / dt,
    z: (end.z - start.z) / dt,
  };
}

function isShaking(hist: Sample[]) {
  let path = 0, reversals = 0, lastDir = 0;
  for (let i = 1; i < hist.length; i++) {
    const dx = hist[i].sx - hist[i - 1].sx, dy = hist[i].sy - hist[i - 1].sy;
    path += Math.hypot(dx, dy);
    // Direction along whichever axis the hand is mostly moving on.
    const d = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : Math.sign(dy) * 2;
    if (d && lastDir && d === -lastDir) reversals++;
    if (d) lastDir = d;
  }
  return path > SHAKE_PATH_PX && reversals >= SHAKE_REVERSALS;
}

/** `onClick` fires instead of a drop when the pointer never moved past the slop (a plain tap).
 *  `onRoll` (dice only) fires repeatedly while the die is shaken in the hand, and once when it's
 *  thrown — a fast release. A thrown die keeps the hand's velocity, slides with friction,
 *  bounces off the rim and settles, Tabletop Simulator-style. */
export function beginDrag(start: { clientX: number; clientY: number }, list: DragItem[], onClick?: () => void, onRoll?: () => void) {
  const at = screenToTable(start.clientX, start.clientY);
  if (!at || !list.length) return;
  active++;
  const offsets = list.map(i => ({ id: i.id, dx: i.x - at.x, dz: i.z - at.z, w: i.w, h: i.h }));
  const many = list.length > 1;
  for (const i of list) localDrag.set(i.id, { x: i.x, z: i.z });
  if (many) store.send('grabMany', { ids: list.map(i => i.id) });
  else store.send('grab', { id: list[0].id });

  let moved = false, lastSend = 0, lastRoll = 0, done = false;
  const hist: Sample[] = [{ t: performance.now(), sx: start.clientX, sy: start.clientY, x: at.x, z: at.z }];
  const current = () => offsets.map(o => ({ id: o.id, ...(localDrag.get(o.id) ?? { x: 0, z: 0 }) }));
  const sendMove = () => {
    if (many) store.send('moveMany', { items: current() });
    else store.send('move', current()[0]);
  };

  const onMove = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - start.clientX, ev.clientY - start.clientY) < CLICK_SLOP_PX) return;
    const p = screenToTable(ev.clientX, ev.clientY);
    if (!p) return;
    moved = true;
    for (const o of offsets) localDrag.set(o.id, clampToTable(p.x + o.dx, p.z + o.dz, o.w, o.h));
    const now = performance.now();
    hist.push({ t: now, sx: ev.clientX, sy: ev.clientY, x: p.x, z: p.z });
    while (hist.length > 1 && now - hist[0].t > HIST_WINDOW_MS) hist.shift();
    if (onRoll && now - lastRoll > SHAKE_THROTTLE_MS && isShaking(hist)) { lastRoll = now; onRoll(); }
    if (now - lastSend < SEND_EVERY_MS) return;
    lastSend = now;
    sendMove();
  };

  const finish = () => {
    if (done) return;
    done = true;
    active = Math.max(0, active - 1);
    const final = current();
    for (const o of offsets) { localDrag.delete(o.id); gliding.delete(o.id); }
    if (many) store.send('dropMany', { items: final });
    else store.send('drop', { ...final[0], snap: moved });
  };

  const stopListening = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('blur', onCancel);
  };

  const onUp = () => {
    stopListening();
    const v = onRoll && moved ? releaseVelocity(hist) : null;
    if (v && v.screen > FLICK_PX_PER_MS) {
      onRoll!();
      glide(v.x, v.z);
      return;
    }
    finish();
    if (!moved && onClick) onClick();
  };

  // Alt-Tab, a system dialog or a lost touch mid-drag: put things down where they are, so
  // nobody is left looking at "Dustin is moving that" forever.
  const onCancel = () => { stopListening(); finish(); };

  const glide = (vx0: number, vz0: number) => {
    let vx = Math.min(Math.max(vx0, -MAX_GLIDE_SPEED), MAX_GLIDE_SPEED);
    let vz = Math.min(Math.max(vz0, -MAX_GLIDE_SPEED), MAX_GLIDE_SPEED);
    let last = performance.now(), sent = 0;
    for (const o of offsets) gliding.add(o.id);
    // rAF can stall (a hidden tab, a minimized or covered window) and would leave the die — and
    // this player's camera — locked mid-slide. A timer races it as a watchdog, and each step
    // integrates the real elapsed time in small substeps, so a long gap still lands exactly
    // where the slide would have.
    const next = () => {
      let fired = false;
      const run = () => { if (!fired) { fired = true; step(performance.now()); } };
      requestAnimationFrame(run);
      setTimeout(run, 100);
    };
    const step = (now: number) => {
      if (done) return;
      let remaining = Math.min(now - last, 2000);
      last = now;
      while (remaining > 0) {
        const dt = Math.min(16, remaining);
        remaining -= dt;
        for (const o of offsets) {
          const cur = localDrag.get(o.id);
          if (!cur) { finish(); return; }
          const nx = cur.x + vx * dt, nz = cur.z + vz * dt;
          const c = clampToTable(nx, nz, o.w, o.h);
          if (c.x !== nx) vx = -vx * RIM_BOUNCE;
          if (c.z !== nz) vz = -vz * RIM_BOUNCE;
          localDrag.set(o.id, c);
        }
        const decay = Math.exp(-GLIDE_FRICTION * dt);
        vx *= decay; vz *= decay;
      }
      if (now - sent > SEND_EVERY_MS) { sent = now; sendMove(); }
      if (Math.hypot(vx, vz) > GLIDE_STOP_SPEED) next();
      else finish();
    };
    next();
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('blur', onCancel);
}
