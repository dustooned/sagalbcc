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
import { beginDrag, localDrag } from './dragging.ts';
import { buildPolyhedronDie, randomQuaternion, type PolyDie } from './polyhedra.ts';
import { ui } from './selection.ts';
import { dieFaceMaterials, MARKER_COLORS, markerMaterial } from './tokenTextures.ts';

const BOX_DIE_KINDS = new Set<SyncedMarker['kind']>(['die', 'diePips']);
type PolyKind = 'd4' | 'd8' | 'd12' | 'd20';
const POLY_KINDS = new Set<SyncedMarker['kind']>(['d4', 'd8', 'd12', 'd20']);

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

/** d20's circumradius reads as roughly the same "size" on the table as a d6/d8/d12 despite having
 * more, smaller faces — this just tunes each shape to a similar visual footprint. */
const POLY_RADIUS: Record<PolyKind, number> = { d4: 0.34, d8: 0.3, d12: 0.28, d20: 0.28 };
const POLY_SUM: Record<PolyKind, number> = { d4: 0, d8: 9, d12: 13, d20: 21 };
const polyCache = new Map<PolyKind, PolyDie>();
function polyDie(kind: PolyKind): PolyDie {
  let d = polyCache.get(kind);
  if (d) return d;
  const r = POLY_RADIUS[kind];
  const base =
    kind === 'd4' ? new THREE.TetrahedronGeometry(r) :
    kind === 'd8' ? new THREE.OctahedronGeometry(r) :
    kind === 'd12' ? new THREE.DodecahedronGeometry(r) :
    new THREE.IcosahedronGeometry(r);
  const sides = { d4: 4, d8: 8, d12: 12, d20: 20 }[kind];
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
  // Never a real face value, so a freshly-mounted die (just spawned, or another player's die
  // showing up for the first time on your screen) always tumbles in instead of snapping to place.
  const lastValue = useRef(-1);
  const spinOffset = useRef(new THREE.Vector3());
  const rollStart = useRef(0);
  const tumbleQuat = useRef(new THREE.Quaternion());
  const currentQuat = useRef(new THREE.Quaternion());
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
    const lifted = localDrag.has(p.id) || (riding && localDrag.has(riding.id));
    const y = (riding ? p.pieceY + 0.06 : 0) + height / 2 + 0.004 + (lifted ? DRAG_LIFT + 0.02 : 0);
    const k = 1 - Math.exp(-dt * 20);
    if (g.position.lengthSq() === 0) g.position.set(pos.x, y, pos.z);
    g.position.x += (pos.x - g.position.x) * k;
    g.position.z += (pos.z - g.position.z) * k;
    g.position.y += (y - g.position.y) * k;

    if (isBoxDie && dieSpin.current) {
      // A fresh roll: tumble a couple of extra full turns around a random axis before settling —
      // the target keeps those extra turns forever, so the exponential ease-toward-target below
      // reads as a spin, not a snap, with no separate animation state machine needed.
      if (lastValue.current !== p.value) {
        lastValue.current = p.value;
        const axis: 'x' | 'y' | 'z' = (['x', 'y', 'z'] as const)[Math.floor(Math.random() * 3)];
        spinOffset.current[axis] += (2 + Math.floor(Math.random() * 2)) * Math.PI * 2;
      }
      const base = DIE_FACE_ROTATIONS[p.value] ?? DIE_FACE_ROTATIONS[1];
      const r = dieSpin.current.rotation;
      const dk = 1 - Math.exp(-dt * 3.5);
      r.x += (base.x + spinOffset.current.x - r.x) * dk;
      r.y += (base.y + spinOffset.current.y - r.y) * dk;
      r.z += (base.z + spinOffset.current.z - r.z) * dk;
    } else if (isPoly && poly && dieSpin.current) {
      // Quaternions can't "add extra turns" the way Euler angles can, so the tumble instead
      // slerps through one random orientation first, then on to the real settled orientation —
      // two legs read as one continuous tumble-and-land motion.
      const TUMBLE_MS = 380;
      if (lastValue.current !== p.value) {
        lastValue.current = p.value;
        rollStart.current = performance.now();
        randomQuaternion(tumbleQuat.current);
      }
      const elapsed = performance.now() - rollStart.current;
      const target = elapsed < TUMBLE_MS ? tumbleQuat.current : poly.quaternionFor(p.value);
      currentQuat.current.slerp(target, 1 - Math.exp(-dt * (elapsed < TUMBLE_MS ? 9 : 5)));
      dieSpin.current.quaternion.copy(currentQuat.current);
    }
  });

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || ui.spaceHeld) return;
    e.stopPropagation();
    e.nativeEvent.preventDefault(); // tells CameraRig this touch grabbed a marker, not the table
    ui.openMenu(null);
    const m = store.state?.markers.get(p.id), pos = markerPos(p.id);
    if (!m || !pos) return;
    if (m.lockedBy && m.lockedBy !== store.playerId) { store.notify(`${store.state?.players.get(m.lockedBy)?.name ?? 'Someone'} is moving that marker.`); return; }
    // A die: a plain tap rolls it, shaking it while held rattles it, and a fast flick on
    // release tosses and rolls it — same gesture for mouse and touch.
    const roll = isDie ? () => actions.rollMarker(p.id) : undefined;
    beginDrag(e, [{ id: p.id, ...pos }], roll, roll);
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
      {isDie ? <group ref={dieSpin}>{mesh}</group> : mesh}
      {p.lockColor && (
        <mesh geometry={outline} rotation-x={-Math.PI / 2} position-y={-height / 2 + 0.001}>
          <meshBasicMaterial color={p.lockColor} />
        </mesh>
      )}
    </group>
  );
});
