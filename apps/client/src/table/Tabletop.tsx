// The shared 3D table: surface and every piece, marker and note.
import { Canvas, useFrame } from '@react-three/fiber';
import { tickAnimatedTextures } from './animatedTextures.ts';

/** Advances animated GIF faces once per rendered frame (video textures update themselves). */
function AnimationClock() {
  useFrame(() => tickAnimatedTextures());
  return null;
}
import { SEAT_COLORS } from '@kitforge/shared-types';
import { useTable } from '../net/tableStore.ts';
import { CameraRig } from './CameraRig.tsx';
import { Marker3D } from './Marker3D.tsx';
import { Note3D } from './Note3D.tsx';
import { Piece3D, pieceBaseY, pieceThickness } from './Piece3D.tsx';
import { SAME_SPOT } from '../pieces/stacks.ts';
import type { SyncedPiece } from '../net/stateTypes.ts';
import { ui, useUi } from './selection.ts';
import { TableSurface } from './TableSurface.tsx';
import { Backdrop3D } from './Backdrop3D.tsx';
import { Atmosphere3D } from './Atmosphere3D.tsx';

export function Tabletop() {
  const t = useTable();
  const u = useUi();
  const state = t.state;
  if (!state) return null;
  const me = t.me();
  const players = [...state.players.values()];
  const seatColor = new Map(players.map(p => [p.id, SEAT_COLORS[p.seat % SEAT_COLORS.length] ?? '#ccc']));
  const pieces = [...state.pieces.values()].sort((a, b) => a.order - b.order);
  // How high a piece rests is its depth *within its own stack* — the pieces sharing its spot and
  // kind. Using the global draw order here (as this used to) meant every piece floated a little
  // higher the more pieces were on the table, while a 20-card deck still looked like one card.
  // Grouping is the same rule the engine uses for stacks, so rendering and behaviour agree.
  const depthOf = new Map<string, number>();
  {
    let previous: SyncedPiece | undefined;
    let depth = 0;
    // Sorting is stable, so within one spot the pieces keep ascending draw order: bottom first.
    for (const c of [...pieces].sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.x - b.x || a.z - b.z))) {
      const stacked = previous && previous.kind === c.kind
        && Math.abs(previous.x - c.x) < SAME_SPOT && Math.abs(previous.z - c.z) < SAME_SPOT;
      depth = stacked ? depth + 1 : 0;
      if (depth) depthOf.set(c.id, depth);
      previous = c;
    }
  }
  const lockColor = (lockedBy: string) => (lockedBy && lockedBy !== t.playerId ? seatColor.get(lockedBy) ?? '#fff' : null);

  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      // Tight near/far keeps depth-buffer precision high at any zoom — a wide range here is what
      // caused shimmering/z-fighting between close-together surfaces (felt vs. table image, the
      // frame's edge strips) when zoomed out.
      camera={{ fov: 42, near: 1, far: 140 }}
      onPointerMissed={e => { if (e.button === 0 && !ui.justBoxed() && !e.shiftKey) ui.clear(); }}
      onContextMenu={e => {
        // A piece/marker/note's own onContextMenu already handled this and called
        // preventDefault() — only open the background hotkeys menu when nothing else did.
        if (e.defaultPrevented) return;
        e.preventDefault();
        // A touch long-press that became a selection box isn't a menu request.
        if (ui.justOrbited() || ui.box || ui.justBoxed()) return;
        ui.openMenu({ x: e.clientX, y: e.clientY, id: '', source: 'background' });
      }}
      scene={{ background: null }}
    >
      <color attach="background" args={['#0e0e16']} />
      <AnimationClock />
      <Backdrop3D json={state.lookBackdrop} />
      <Atmosphere3D json={state.lookAtmosphere} />
      <CameraRig seat={me?.seat ?? 0} />
      <ambientLight intensity={0.95} />
      <directionalLight position={[6, 18, 8]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-20} shadow-camera-right={20} shadow-camera-top={15} shadow-camera-bottom={-15} />
      <TableSurface felt={state.lookFelt} image={state.lookImage} grid={state.gridSize ?? 0} />
      {pieces.map(c => (
        <Piece3D
          key={c.id}
          id={c.id}
          kind={c.kind}
          face={c.face}
          w={c.w}
          h={c.h}
          faceUp={c.faceUp}
          rotation={c.rotation}
          tapped={c.tapped}
          orient={c.orient}
          backImage={c.backImage}
          depth={depthOf.get(c.id) ?? 0}
          selected={u.selected.has(c.id)}
          hovered={u.hovered === c.id}
          snapTarget={u.snapTarget === c.id}
          locked={c.locked}
          lockColor={lockColor(c.lockedBy)}
        />
      ))}
      {[...state.notes.values()].map(n => (
        <Note3D key={n.id} id={n.id} text={n.text} author={n.author} lockColor={lockColor(n.lockedBy)} />
      ))}
      {[...state.markers.values()].map(m => {
        const on = m.attachedTo ? state.pieces.get(m.attachedTo) : undefined;
        // A marker rides on top of the piece it was dropped on, using that piece's own height.
        const pieceY = on ? pieceBaseY(depthOf.get(on.id) ?? 0, pieceThickness(on.kind, on.w, on.h)) : 0;
        return <Marker3D key={m.id} id={m.id} kind={m.kind} label={m.label} value={m.value} rolls={m.rolls} pieceY={pieceY} lockColor={lockColor(m.lockedBy)} />;
      })}
    </Canvas>
  );
}
