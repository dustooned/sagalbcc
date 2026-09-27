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
import { ui } from './selection.ts';
import { dieMaterial, MARKER_COLORS, markerMaterial } from './tokenTextures.ts';

const RADIUS = 0.24, HEIGHT = 0.06;
const geometry = new THREE.CylinderGeometry(RADIUS, RADIUS, HEIGHT, 32);
const outline = new THREE.RingGeometry(RADIUS + 0.02, RADIUS + 0.07, 32);
const DIE_SIZE = 0.42;
const dieGeometry = new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE);
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
  const isDie = p.kind === 'die';
  const height = isDie ? DIE_SIZE : HEIGHT;
  const materials = useMemo(
    () => (isDie ? dieMaterial(p.value) : [side(MARKER_COLORS[p.kind]), markerMaterial(p), side(MARKER_COLORS[p.kind])]),
    [isDie, p.kind, p.label, p.value], // eslint-disable-line react-hooks/exhaustive-deps
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
  });

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || ui.spaceHeld) return;
    e.stopPropagation();
    e.nativeEvent.preventDefault(); // tells CameraRig this touch grabbed a marker, not the table
    ui.openMenu(null);
    const m = store.state?.markers.get(p.id), pos = markerPos(p.id);
    if (!m || !pos) return;
    if (m.lockedBy && m.lockedBy !== store.playerId) { store.notify(`${store.state?.players.get(m.lockedBy)?.name ?? 'Someone'} is moving that marker.`); return; }
    // A die: a plain tap rolls it (no drag needed) — dragging still moves it like any token.
    beginDrag(e, [{ id: p.id, ...pos }], isDie ? () => actions.rollMarker(p.id) : undefined);
  };

  const yaw = THREE.MathUtils.degToRad(seatAngle(store.me()?.seat ?? 0) + 90);

  return (
    <group ref={group} rotation-y={yaw}>
      <mesh
        geometry={isDie ? dieGeometry : geometry}
        material={materials}
        castShadow
        onPointerDown={onPointerDown}
        onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = 'grab'; }}
        onPointerOut={() => { document.body.style.cursor = ''; }}
        onContextMenu={e => { e.stopPropagation(); e.nativeEvent.preventDefault(); ui.openMenu({ x: e.clientX, y: e.clientY, id: p.id, source: 'marker' }); }}
      />
      {p.lockColor && (
        <mesh geometry={outline} rotation-x={-Math.PI / 2} position-y={-height / 2 + 0.001}>
          <meshBasicMaterial color={p.lockColor} />
        </mesh>
      )}
    </group>
  );
});
