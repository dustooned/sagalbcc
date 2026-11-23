// Presence: everyone's pointer on the felt, plus "look here" pings. Lives inside the Canvas.
//
// Sending: mouse/pen movement over the felt goes out as `point`, at most every SEND_EVERY_MS;
// leaving the felt (or the canvas) hides it. Alt+click pings the spot under the cursor.
// Showing: each other player's pointer is a ring in their seat colour. The server stamps
// `pointerAt` with a tick that changes on every update, so staleness is measured on *this*
// machine — from the moment we last saw the tick change — and never against the server's clock.
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { TABLE_HALF_D, TABLE_HALF_W, type Point2 } from '@kitforge/shared-types';
import { actions } from '../pieces/actions.ts';
import { store } from '../net/tableStore.ts';
import { presence } from './presence.ts';
import { screenToTable } from './tablePointer.ts';

const SEND_EVERY_MS = 50;
/** A pointer stays fully visible this long after it last moved, then fades out over FADE_MS. */
const VISIBLE_MS = 1500, FADE_MS = 500;
const PULSE_MS = 800;
/** Above cards and most stacks; depthTest is off anyway so pieces never hide a pointer. */
const HEIGHT = 0.35;
const FLAT = -Math.PI / 2;

const onFelt = (at: Point2 | null): at is Point2 => !!at && Math.abs(at.x) <= TABLE_HALF_W && Math.abs(at.z) <= TABLE_HALF_D;

/** Streams this player's pointer to the table and turns Alt+click into a ping. */
function usePointerSender() {
  const { gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    let last = 0, timer = 0, shown = false;
    let next: Point2 | null = null;
    const flush = () => {
      timer = 0;
      last = performance.now();
      if (next) { actions.point(next); shown = true; } else if (shown) { actions.point(); shown = false; }
    };
    const queue = (at: Point2 | null) => {
      next = at;
      // Hiding goes out at once; positions are throttled.
      if (!at) { if (timer) { clearTimeout(timer); timer = 0; } flush(); return; }
      if (!timer) timer = window.setTimeout(flush, Math.max(0, SEND_EVERY_MS - (performance.now() - last)));
    };
    const onMove = (e: PointerEvent) => {
      // Touch "pointing" is just orbiting and dragging — not worth broadcasting.
      if (e.pointerType === 'touch' || !presence.sharing || !store.room) return;
      const at = screenToTable(e.clientX, e.clientY);
      queue(onFelt(at) ? { x: at.x, z: at.z } : null);
    };
    const hide = () => queue(null);
    // Capture phase at the window, so Alt+click pings even on top of a piece instead of grabbing it.
    const onDown = (e: PointerEvent) => {
      if (!e.altKey || e.button !== 0 || e.target !== el) return;
      e.preventDefault();
      e.stopPropagation();
      const at = screenToTable(e.clientX, e.clientY);
      if (onFelt(at)) actions.pingAt(at);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', hide);
    window.addEventListener('blur', hide);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      if (timer) clearTimeout(timer);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', hide);
      window.removeEventListener('blur', hide);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [gl]);
}

const flatMaterial = (color: string) => (
  <meshBasicMaterial color={color} transparent opacity={0} depthTest={false} depthWrite={false} toneMapped={false} />
);

/** One player's pointer ring and ping pulse. Reads the synced state every frame — no re-render. */
function PlayerPointer({ id, color }: { id: string; color: string }) {
  const pointer = useRef<THREE.Group>(null);
  const pulse = useRef<THREE.Mesh>(null);
  const seen = useRef<{ at: number; ms: number; pingAt: number; pingMs: number } | null>(null);

  useFrame((_, dt) => {
    const g = pointer.current, ring = pulse.current;
    if (!g || !ring) return;
    const p = store.state?.players.get(id);
    const now = performance.now();
    if (!p) { g.visible = false; ring.visible = false; return; }
    // First sight: remember what's already there, so an old pointer or ping isn't replayed.
    const s = seen.current ??= { at: p.pointerAt, ms: -Infinity, pingAt: p.pingAt, pingMs: -Infinity };

    if (p.pointerAt !== s.at) {
      const wasHidden = now - s.ms > VISIBLE_MS + FADE_MS;
      s.at = p.pointerAt;
      s.ms = now;
      if (wasHidden) g.position.set(p.pointerX, HEIGHT, p.pointerZ);
    }
    const mine = id === store.playerId;
    const age = now - s.ms;
    const alpha = !mine && p.connected && p.pointerAt !== 0 ? THREE.MathUtils.clamp((VISIBLE_MS + FADE_MS - age) / FADE_MS, 0, 1) : 0;
    g.visible = alpha > 0;
    if (g.visible) {
      const k = 1 - Math.exp(-dt * 20);
      g.position.x += (p.pointerX - g.position.x) * k;
      g.position.z += (p.pointerZ - g.position.z) * k;
      g.position.y = HEIGHT;
      for (const child of g.children) ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = alpha * 0.95;
    }

    // Pings show for everyone, yourself included — it's how you see that yours went out.
    if (p.pingAt !== s.pingAt) {
      s.pingAt = p.pingAt;
      s.pingMs = now;
      ring.position.set(p.pingX, HEIGHT, p.pingZ);
    }
    const t = (now - s.pingMs) / PULSE_MS;
    ring.visible = t >= 0 && t < 1;
    if (ring.visible) {
      ring.scale.setScalar(0.4 + t * 2.6);
      (ring.material as THREE.MeshBasicMaterial).opacity = 1 - t;
    }
  });

  return (
    <>
      <group ref={pointer} visible={false}>
        <mesh rotation-x={FLAT} renderOrder={1000}>
          <ringGeometry args={[0.34, 0.5, 40]} />
          {flatMaterial(color)}
        </mesh>
        <mesh rotation-x={FLAT} renderOrder={1000}>
          <circleGeometry args={[0.12, 20]} />
          {flatMaterial(color)}
        </mesh>
      </group>
      <mesh ref={pulse} rotation-x={FLAT} renderOrder={1000} visible={false}>
        <ringGeometry args={[0.85, 1, 48]} />
        {flatMaterial(color)}
      </mesh>
    </>
  );
}

export function PointerLayer({ players }: { players: { id: string; color: string }[] }) {
  usePointerSender();
  return <>{players.map(p => <PlayerPointer key={p.id} id={p.id} color={p.color} />)}</>;
}
