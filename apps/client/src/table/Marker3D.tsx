// A marker token. Loose on the table, or riding on a piece (drawn at piece + offset, so it
// follows the piece even mid-drag). Drag it off a piece to detach; drop it on one to attach.
import { memo, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { seatAngle, type Point2 } from '@kitforge/shared-types';
import type { SyncedMarker } from '../net/stateTypes.ts';
import { store } from '../net/tableStore.ts';
import { actions } from '../pieces/actions.ts';
import { DRAG_LIFT } from './Piece3D.tsx';
import { beginDrag, gliding, localDrag } from './dragging.ts';
import { buildPolyhedronDie, trapezohedronGeometry, type PolyDie } from './polyhedra.ts';
import { kickDie, newDieMotion, stepDie, type DieMotion } from './diceMotion.ts';
import { ui } from './selection.ts';
import { dieFaceMaterials, MARKER_COLORS, markerMaterial } from './tokenTextures.ts';

const BOX_DIE_KINDS = new Set<SyncedMarker['kind']>(['die', 'diePips']);
type PolyKind = 'd4' | 'd8' | 'd10' | 'd12' | 'd20';
const POLY_KINDS = new Set<SyncedMarker['kind']>(['d4', 'd8', 'd10', 'd12', 'd20']);

const RADIUS = 0.24, HEIGHT = 0.06;
const geometry = new THREE.CylinderGeometry(RADIUS, RADIUS, HEIGHT, 32);
const outline = new THREE.RingGeometry(RADIUS + 0.02, RADIUS + 0.07, 32);
const DIE_SIZE = 0.42;
const dieGeometry = new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE);

/** Rotation (radians) that brings each value's face to point world-up (+Y), matching
 * DIE_FACE_VALUES = [1,6,2,5,3,4] on BoxGeometry's own [+x,-x,+y,-y,+z,-z] face order. */
const DIE_FACE_ROTATIONS: Record<number, THREE.Euler> = {
  1: new THREE.Euler(0, 0, Math.PI / 2),
  2: new THREE.Euler(0, 0, 0),
  3: new THREE.Euler(-Math.PI / 2, 0, 0),
  4: new THREE.Euler(Math.PI / 2, 0, 0),
  5: new THREE.Euler(Math.PI, 0, 0),
  6: new THREE.Euler(0, 0, -Math.PI / 2),
};

/** Corner points (die-local) each shape stands on — lets a tipping die rock on an edge. */
const BOX_HULL = [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => new THREE.Vector3(x, y, z).multiplyScalar(DIE_SIZE / 2))));
const polyHulls = new Map<PolyKind, THREE.Vector3[]>();
function polyHull(kind: PolyKind, geometry: THREE.BufferGeometry) {
  let h = polyHulls.get(kind);
  if (h) return h;
  const pos = geometry.getAttribute('position'), seen = new Set<string>();
  h = [];
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) { seen.add(key); h.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))); }
  }
  polyHulls.set(kind, h);
  return h;
}

const DIE_FACE_QUATS: Record<number, THREE.Quaternion> = Object.fromEntries(
  Object.entries(DIE_FACE_ROTATIONS).map(([v, e]) => [v, new THREE.Quaternion().setFromEuler(e)]),
);

/** d20's circumradius reads as roughly the same "size" on the table as a d6/d8/d12 despite having
 * more, smaller faces — this just tunes each shape to a similar visual footprint. */
const POLY_RADIUS: Record<PolyKind, number> = { d4: 0.34, d8: 0.3, d10: 0.3, d12: 0.28, d20: 0.28 };
const POLY_SUM: Record<PolyKind, number> = { d4: 0, d8: 9, d10: 11, d12: 13, d20: 21 };
const polyCache = new Map<PolyKind, PolyDie>();
function polyDie(kind: PolyKind): PolyDie {
  let d = polyCache.get(kind);
  if (d) return d;
  const r = POLY_RADIUS[kind];
  const base =
    kind === 'd4' ? new THREE.TetrahedronGeometry(r) :
    kind === 'd8' ? new THREE.OctahedronGeometry(r) :
    kind === 'd10' ? trapezohedronGeometry(r) :
    kind === 'd12' ? new THREE.DodecahedronGeometry(r) :
    new THREE.IcosahedronGeometry(r);
  const sides = { d4: 4, d8: 8, d10: 10, d12: 12, d20: 20 }[kind];
  d = buildPolyhedronDie(base, sides, POLY_SUM[kind]);
  polyCache.set(kind, d);
  return d;
}

const sideMaterials = new Map<string, THREE.MeshStandardMaterial>();
const side = (color: string) => {
  let m = sideMaterials.get(color);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.6 }); sideMaterials.set(color, m); }
  return m;
};

export interface Marker3DProps {
  id: string;
  kind: SyncedMarker['kind'];
  label: string;
  value: number;
  /** Server roll counter — changes on every roll, even one that lands on the same number. */
  rolls: number;
  /** Resting height of the piece it rides on (0 when loose). */
  pieceY: number;
  lockColor: string | null;
}

function markerPos(id: string): Point2 | null {
  const dragging = localDrag.get(id);
  if (dragging) return dragging;
  const m = store.state?.markers.get(id);
  if (!m) return null;
  const piece = m.attachedTo ? store.piece(m.attachedTo) : undefined;
  if (!piece) return { x: m.x, z: m.z };
  const base = localDrag.get(piece.id) ?? piece;
  return { x: base.x + m.ox, z: base.z + m.oz };
}

export const Marker3D = memo(function Marker3D(p: Marker3DProps) {
  const group = useRef<THREE.Group>(null);
  const dieSpin = useRef<THREE.Group>(null);
  // Keyed on the roll counter as well as the value, so rolling the same number still tumbles.
  // Starts empty, so a freshly-mounted die (just spawned, or another player's die showing up on
  // your screen for the first time) tumbles in instead of snapping to place.
  const lastRoll = useRef('');
  const rollKey = `${p.rolls}:${p.value}`;
  const motion = useRef<DieMotion | null>(null);
  const worldPos = useRef(new THREE.Vector3());
  const yawInv = useRef(new THREE.Quaternion());
  const isBoxDie = BOX_DIE_KINDS.has(p.kind);
  const isPoly = POLY_KINDS.has(p.kind);
  const isDie = isBoxDie || isPoly;
  const poly = isPoly ? polyDie(p.kind as PolyKind) : null;
  const height = isBoxDie ? DIE_SIZE : isPoly ? POLY_RADIUS[p.kind as PolyKind] * 2 : HEIGHT;
  const materials = useMemo(
    () => (isBoxDie ? dieFaceMaterials(p.kind === 'diePips') : [side(MARKER_COLORS[p.kind]), markerMaterial(p), side(MARKER_COLORS[p.kind])]),
    [isBoxDie, p.kind, p.label, p.value], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useFrame((_, dt) => {
    const g = group.current;
    const pos = markerPos(p.id);
    if (!g || !pos) return;
    const m = store.state?.markers.get(p.id);
    const riding = m?.attachedTo ? store.piece(m.attachedTo) : undefined;
    const lifted = (localDrag.has(p.id) && !gliding.has(p.id)) || (riding && localDrag.has(riding.id));
    const y = (riding ? p.pieceY + 0.06 : 0) + height / 2 + 0.004 + (lifted ? DRAG_LIFT + 0.02 : 0);
    let hop = 0;
    const k = 1 - Math.exp(-dt * 20);
    if (g.position.lengthSq() === 0) g.position.set(pos.x, y, pos.z);
    g.position.x += (pos.x - g.position.x) * k;
    g.position.z += (pos.z - g.position.z) * k;
    g.position.y += (y - g.position.y) * k;

    if (isDie && dieSpin.current) {
      const face = isBoxDie ? DIE_FACE_QUATS[p.value] ?? DIE_FACE_QUATS[1] : poly!.quaternionFor(p.value);
      const m = (motion.current ??= newDieMotion(face));
      const inHand = !!lifted;
      if (lastRoll.current !== rollKey) {
        // A fresh roll (also on first appearance, so a new die tumbles in rather than popping up).
        lastRoll.current = rollKey;
        kickDie(m, inHand);
      }
      const radius = isBoxDie ? DIE_SIZE / 2 : POLY_RADIUS[p.kind as PolyKind] * 0.8;
      const hull = isBoxDie ? BOX_HULL : polyHull(p.kind as PolyKind, poly!.geometry);
      hop = stepDie(m, worldPos.current.copy(g.position), dt, radius, face, inHand, hull);
      // The die group is turned to face this player's seat; orientation is kept in world space.
      dieSpin.current.quaternion.copy(yawInv.current.copy(g.quaternion).invert()).multiply(m.q);
      dieSpin.current.position.y = hop;
    } else if (dieSpin.current) {
      // A flat token (+1, DMG, STATUS, custom): flips end over end like a coin while it's
      // sliding from a throw, then lays back down face-up.
      const r = dieSpin.current.rotation;
      if (gliding.has(p.id)) r.x += dt * 16;
      else r.x += (Math.round(r.x / (Math.PI * 2)) * Math.PI * 2 - r.x) * (1 - Math.exp(-dt * 10));
    }
  });

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || ui.spaceHeld || e.ctrlKey || e.metaKey) return; // Ctrl/⌘+drag = box select
    e.stopPropagation();
    e.nativeEvent.preventDefault(); // tells CameraRig this touch grabbed a marker, not the table
    ui.openMenu(null);
    const m = store.state?.markers.get(p.id), pos = markerPos(p.id);
    if (!m || !pos) return;
    if (m.lockedBy && m.lockedBy !== store.playerId) { store.notify(`${store.state?.players.get(m.lockedBy)?.name ?? 'Someone'} is moving that marker.`); return; }
    // A die: a plain tap rolls it, shaking it while held rattles it, and a fast flick on
    // release throws and rolls it. Any other token can be thrown too (it just flips, no roll).
    // Same gestures for mouse and touch.
    const roll = isDie ? () => actions.rollMarker(p.id) : undefined;
    beginDrag(e, [{ id: p.id, ...pos }], { onClick: roll, onRoll: roll, throwable: true });
  };

  const yaw = THREE.MathUtils.degToRad(seatAngle(store.me()?.seat ?? 0) + 90);

  const mesh = (
    <mesh
      geometry={isBoxDie ? dieGeometry : isPoly && poly ? poly.geometry : geometry}
      material={isBoxDie ? materials : isPoly && poly ? poly.material : materials}
      castShadow
      onPointerDown={onPointerDown}
      onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = 'grab'; }}
      onPointerOut={() => { document.body.style.cursor = ''; }}
      onContextMenu={e => { e.stopPropagation(); e.nativeEvent.preventDefault(); ui.openMenu({ x: e.clientX, y: e.clientY, id: p.id, source: 'marker' }); }}
    />
  );

  return (
    <group ref={group} rotation-y={yaw}>
      <group ref={dieSpin}>{mesh}</group>
      {p.lockColor && (
        <mesh geometry={outline} rotation-x={-Math.PI / 2} position-y={-height / 2 + 0.001}>
          <meshBasicMaterial color={p.lockColor} />
        </mesh>
      )}
    </group>
  );
});
