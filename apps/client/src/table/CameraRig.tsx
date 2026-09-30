// Tabletop camera, TTS-style: right-drag orbits around the table, wheel zooms, middle-drag or
// Space+drag pans, Home resets. Touch: one finger orbits, two fingers pan and pinch-zoom — a
// piece/marker/note's own onPointerDown calls preventDefault() so its touch is never also read
// here as a table drag. Starts looking from your own seat. The on-screen camera buttons
// (hud/CameraPanel) drive the same view through `cameraControls`, so touch devices can orbit too.
// Shift+drag on empty table, or Ctrl/⌘+drag from anywhere (even on a piece), draws a selection
// box that adds to the selection. A plain drag on the table does nothing;
// on touch, hold one finger still for a moment and then drag (or turn on the ⬚ Select button).
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { seatAngle } from '@kitforge/shared-types';
import { store } from '../net/tableStore.ts';
import { isDragging } from './dragging.ts';
import { ui } from './selection.ts';
import { registerProjector } from './tablePointer.ts';

const DEG = Math.PI / 180;
const DEFAULT_PITCH = 58, MIN_PITCH = 18, MAX_PITCH = 89;
const DEFAULT_DIST = 26, MIN_DIST = 6, MAX_DIST = 60;
const ORBIT_SLOP_PX = 4;
/** Touch: hold a finger this long without moving to start a selection box instead of orbiting. */
const HOLD_TO_BOX_MS = 450, HOLD_SLOP_PX = 10;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

interface View { tx: number; tz: number; dist: number; yaw: number; pitch: number }
const home = (): View => ({ tx: 0, tz: 0, dist: DEFAULT_DIST, yaw: 0, pitch: DEFAULT_PITCH });

/** Target view the rig eases toward; drags and buttons both write here. `yaw` is degrees added
 * on top of your seat's own facing. */
let target: View = home();

export const cameraControls = {
  rotate(deg: number) { target.yaw += deg; },
  tilt(deg: number) { target.pitch = THREE.MathUtils.clamp(target.pitch + deg, MIN_PITCH, MAX_PITCH); },
  zoom(factor: number) { target.dist = THREE.MathUtils.clamp(target.dist * factor, MIN_DIST, MAX_DIST); },
  topDown() { target.pitch = target.pitch > 85 ? DEFAULT_PITCH : MAX_PITCH; },
  reset() { target = home(); },
};

export function CameraRig({ seat }: { seat: number }) {
  const { camera, gl } = useThree();
  const seatYaw = seatAngle(seat);
  const current = useRef<View>(home());
  const offset = useRef(new THREE.Vector3());

  useEffect(() => { cameraControls.reset(); current.current = home(); }, [seat]);
  useEffect(() => registerProjector(camera, gl.domElement), [camera, gl]);

  useEffect(() => {
    const el = gl.domElement;
    let pan: { x: number; y: number } | null = null;
    let orbit: { x: number; y: number; moved: boolean } | null = null;
    // Active touches by pointerId, for one-finger orbit / two-finger pan+pinch. A piece's own
    // onPointerDown calls preventDefault(), so a touch that grabbed something never lands here.
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { dist: number; mx: number; my: number; baseDist: number } | null = null;
    let box: { id: number; x0: number; y0: number; add: boolean; moved: boolean } | null = null;
    // Touch: a finger held still on empty table turns into a selection box (drag = orbit as usual).
    let hold: { id: number; x: number; y: number; timer: number } | null = null;
    const cancelHold = () => { if (hold) { clearTimeout(hold.timer); hold = null; } };
    const armHold = (e: PointerEvent) => {
      cancelHold();
      const h = { id: e.pointerId, x: e.clientX, y: e.clientY, timer: 0 };
      h.timer = window.setTimeout(() => {
        if (hold !== h || touches.size !== 1) return;
        hold = null;
        touches.delete(h.id); orbit = null;
        box = { id: h.id, x0: h.x, y0: h.y, add: true, moved: true };
        ui.setBox({ x0: h.x, y0: h.y, x1: h.x, y1: h.y });
        if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(15);
      }, HOLD_TO_BOX_MS);
      hold = h;
    };

    /** Every piece whose middle is inside the box. Boards only count when nothing else is in
     *  it, so boxing cards that sit on a board doesn't pick up the board too. */
    const piecesInBox = (x0: number, y0: number, x1: number, y1: number) => {
      const r = el.getBoundingClientRect(), v = new THREE.Vector3();
      const [l, rt, t, b] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)];
      const hits = [...(store.state?.pieces.values() ?? [])].filter(p => {
        if (p.lockedBy && p.lockedBy !== store.playerId) return false;
        v.set(p.x, 0, p.z).project(camera);
        const sx = r.left + ((v.x + 1) / 2) * r.width, sy = r.top + ((1 - v.y) / 2) * r.height;
        return v.z < 1 && sx >= l && sx <= rt && sy >= t && sy <= b;
      });
      const loose = hits.filter(p => p.kind !== 'board');
      return (loose.length ? loose : hits).map(p => p.id);
    };
    const startBox = (e: PointerEvent) => {
      box = { id: e.pointerId, x0: e.clientX, y0: e.clientY, add: e.shiftKey || e.ctrlKey || e.metaKey, moved: false };
    };
    const moveBox = (e: PointerEvent) => {
      if (!box || e.pointerId !== box.id) return false;
      if (!box.moved && Math.hypot(e.clientX - box.x0, e.clientY - box.y0) < ORBIT_SLOP_PX) return true;
      box.moved = true;
      ui.setBox({ x0: box.x0, y0: box.y0, x1: e.clientX, y1: e.clientY });
      return true;
    };
    const endBox = (e: PointerEvent) => {
      if (!box || e.pointerId !== box.id) return false;
      const b = box; box = null;
      // Ctrl/⌘+click on a piece (no drag): toggle just that one, like Shift+click.
      if (!b.moved) { if (b.add && ui.hovered && store.piece(ui.hovered)) { ui.toggle(ui.hovered); ui.setBox(null); } return true; }
      const ids = piecesInBox(b.x0, b.y0, e.clientX, e.clientY);
      ui.select(b.add ? [...new Set([...ui.selected, ...ids])] : ids);
      ui.setBox(null);
      return true;
    };

    const panBy = (dx: number, dy: number) => {
      const k = target.dist * 0.0016;
      const yaw = (seatYaw + target.yaw) * DEG;
      const right = { x: Math.cos(yaw), z: -Math.sin(yaw) }, up = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
      target.tx = THREE.MathUtils.clamp(target.tx - (right.x * dx - up.x * dy) * k, -30, 30);
      target.tz = THREE.MathUtils.clamp(target.tz - (right.z * dx - up.z * dy) * k, -22, 22);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cameraControls.zoom(Math.exp(e.deltaY * 0.0012));
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        if (e.defaultPrevented) return; // a piece/marker/note claimed this touch instead
        // Holding or throwing something: the view stays put until it's down, so a second
        // finger can't spin the table mid-throw. Only this player's own camera is affected.
        if (isDragging()) return;
        if (ui.boxMode && !touches.size && !box) { startBox(e); return; }
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 1) {
          orbit = { x: e.clientX, y: e.clientY, moved: false };
          armHold(e);
        } else if (touches.size === 2) {
          cancelHold();
          orbit = null;
          const [a, b] = [...touches.values()];
          pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, baseDist: target.dist };
        }
        return;
      }
      if (e.button === 1 || (e.button === 0 && ui.spaceHeld)) {
        e.preventDefault();
        pan = { x: e.clientX, y: e.clientY };
        el.setPointerCapture?.(e.pointerId);
      } else if (e.button === 2) {
        orbit = { x: e.clientX, y: e.clientY, moved: false };
      } else if (e.button === 0 && !e.defaultPrevented && (e.shiftKey || e.ctrlKey || e.metaKey)) {
        // Box select only while a modifier is held, so a stray drag on the table does nothing.
        startBox(e);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (moveBox(e)) return;
      if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
        if (isDragging()) { touches.clear(); orbit = null; pinch = null; cancelHold(); return; }
        if (hold && e.pointerId === hold.id && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > HOLD_SLOP_PX) cancelHold();
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size >= 2) {
          const [a, b] = [...touches.values()];
          if (!pinch) pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, baseDist: target.dist };
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          target.dist = THREE.MathUtils.clamp(pinch.baseDist * (pinch.dist / Math.max(dist, 1)), MIN_DIST, MAX_DIST);
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          panBy(mx - pinch.mx, my - pinch.my);
          pinch.mx = mx; pinch.my = my;
          return;
        }
        if (orbit) {
          const dx = e.clientX - orbit.x, dy = e.clientY - orbit.y;
          if (!orbit.moved && Math.hypot(dx, dy) < ORBIT_SLOP_PX) return;
          if (!orbit.moved) orbit.moved = true;
          orbit.x = e.clientX; orbit.y = e.clientY;
          target.yaw -= dx * 0.3;
          target.pitch = THREE.MathUtils.clamp(target.pitch + dy * 0.25, MIN_PITCH, MAX_PITCH);
        }
        return;
      }
      if (orbit) {
        const dx = e.clientX - orbit.x, dy = e.clientY - orbit.y;
        if (!orbit.moved && Math.hypot(dx, dy) < ORBIT_SLOP_PX) return;
        if (!orbit.moved) { orbit.moved = true; ui.openMenu(null); document.body.style.cursor = 'grabbing'; }
        orbit.x = e.clientX; orbit.y = e.clientY;
        target.yaw -= dx * 0.3;
        target.pitch = THREE.MathUtils.clamp(target.pitch + dy * 0.25, MIN_PITCH, MAX_PITCH);
        return;
      }
      if (!pan) return;
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      pan = { x: e.clientX, y: e.clientY };
      panBy(dx, dy);
    };
    const onUp = (e: PointerEvent) => {
      if (endBox(e)) return;
      if (e.pointerType === 'touch') {
        if (hold?.id === e.pointerId) cancelHold();
        touches.delete(e.pointerId);
        if (touches.size < 2) pinch = null;
        if (touches.size === 0) orbit = null;
        else if (touches.size === 1) { const [only] = [...touches.values()]; orbit = { x: only.x, y: only.y, moved: false }; }
        return;
      }
      if (orbit) {
        // A right-drag orbits; only a plain right-click should open a piece's menu.
        if (orbit.moved) { ui.markOrbit(); document.body.style.cursor = ''; }
        orbit = null;
      }
      if (pan) { pan = null; el.releasePointerCapture?.(e.pointerId); }
    };
    const onCancel = (e: PointerEvent) => { if (hold?.id === e.pointerId) cancelHold(); if (box?.id === e.pointerId) { box = null; ui.setBox(null); } touches.delete(e.pointerId); if (touches.size < 2) pinch = null; if (touches.size === 0) orbit = null; };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Home' && !(e.target as HTMLElement)?.closest?.('input, textarea')) cameraControls.reset();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
    };
  }, [gl, seatYaw, camera]);

  useFrame((_, dt) => {
    const c = current.current, k = 1 - Math.exp(-dt * 12);
    c.tx += (target.tx - c.tx) * k;
    c.tz += (target.tz - c.tz) * k;
    c.dist += (target.dist - c.dist) * k;
    c.yaw += (target.yaw - c.yaw) * k;
    c.pitch += (target.pitch - c.pitch) * k;
    const pitch = c.pitch * DEG, yaw = (seatYaw + c.yaw) * DEG;
    offset.current.set(0, Math.sin(pitch) * c.dist, Math.cos(pitch) * c.dist).applyAxisAngle(Y_AXIS, yaw);
    camera.position.set(c.tx + offset.current.x, offset.current.y, c.tz + offset.current.z);
    camera.lookAt(c.tx, 0, c.tz);
  });
  return null;
}
