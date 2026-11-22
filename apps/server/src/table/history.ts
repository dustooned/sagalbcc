// Undo/redo for the table. Tabletop Simulator keeps a stack of undoable actions (and rewind
// saves) so a mis-drag or a bad shuffle is one keypress away from being gone; this is the same
// idea in the simplest form that fits an in-memory Colyseus room: a bounded stack of whole-table
// snapshots. The table is small (pieces/markers/notes plus the shared look), so a snapshot costs
// far less than the bookkeeping of a per-operation inverse.
//
// What is *not* in a snapshot: connected players and the log. Undo should never remove somebody
// from the table, and the log is the record of what happened — including the undo itself.
import { MarkerState, NoteState, PieceState, TableState } from './TableState.ts';

export const MAX_UNDO_STEPS = 50;
/** Cheap ceiling so a table full of 3D boards can't grow history without bound. */
export const MAX_HISTORY_BYTES = 6 * 1024 * 1024;

interface SnapPiece {
  id: string; ownerId: string; x: number; z: number; w: number; h: number; rotation: number;
  faceUp: boolean; tapped: boolean; order: number; lockedBy: string; locked: boolean;
  face: string; backImage: string; kind: string; orient: number;
}
interface SnapMarker {
  id: string; kind: string; label: string; value: number; x: number; z: number; lockedBy: string;
  attachedTo: string; ox: number; oz: number; order: number; rolls: number;
}
interface SnapNote { id: string; text: string; author: string; x: number; z: number; lockedBy: string; order: number }

export interface TableSnapshot {
  v: 1;
  pieces: SnapPiece[];
  markers: SnapMarker[];
  notes: SnapNote[];
  counterNames: string[];
  /** Per-player counter values, keyed by player id then counter name. */
  counters: Record<string, Record<string, number>>;
  look: { felt: string; image: string; backdrop: string; atmosphere: string };
  /** Inches between grid lines; optional so saves written before the grid existed still load. */
  gridSize?: number;
}

/** A JSON string, ready to hand back to `restoreSnapshot`. */
export function snapshotOf(state: TableState): string {
  const counters: Record<string, Record<string, number>> = {};
  for (const player of state.players.values()) {
    const row: Record<string, number> = {};
    for (const [key, value] of player.counters.entries()) row[key] = value;
    counters[player.id] = row;
  }
  const snapshot: TableSnapshot = {
    v: 1,
    pieces: [...state.pieces.values()].map(p => ({
      id: p.id, ownerId: p.ownerId, x: p.x, z: p.z, w: p.w, h: p.h, rotation: p.rotation,
      faceUp: p.faceUp, tapped: p.tapped, order: p.order, lockedBy: p.lockedBy, locked: p.locked,
      face: p.face, backImage: p.backImage, kind: p.kind, orient: p.orient,
    })),
    markers: [...state.markers.values()].map(m => ({
      id: m.id, kind: m.kind, label: m.label, value: m.value, x: m.x, z: m.z, lockedBy: m.lockedBy,
      attachedTo: m.attachedTo, ox: m.ox, oz: m.oz, order: m.order, rolls: m.rolls,
    })),
    notes: [...state.notes.values()].map(n => ({ id: n.id, text: n.text, author: n.author, x: n.x, z: n.z, lockedBy: n.lockedBy, order: n.order })),
    counterNames: [...state.counterNames],
    counters,
    look: { felt: state.lookFelt, image: state.lookImage, backdrop: state.lookBackdrop, atmosphere: state.lookAtmosphere },
    gridSize: state.gridSize,
  };
  return JSON.stringify(snapshot);
}

/** Rebuilds the table from a snapshot, in place — Colyseus needs the same state object mutated,
 *  never replaced. Drag locks are dropped: after an undo nobody is holding anything. */
export function restoreSnapshot(state: TableState, json: string): boolean {
  let snap: TableSnapshot;
  try { snap = JSON.parse(json) as TableSnapshot; } catch { return false; }
  if (!snap || snap.v !== 1) return false;

  state.pieces.clear();
  for (const s of snap.pieces ?? []) {
    const p = new PieceState();
    p.id = s.id; p.ownerId = s.ownerId; p.x = s.x; p.z = s.z; p.w = s.w; p.h = s.h;
    p.rotation = s.rotation; p.faceUp = s.faceUp; p.tapped = s.tapped; p.order = s.order;
    p.lockedBy = ''; p.locked = !!s.locked; p.face = s.face; p.backImage = s.backImage;
    p.kind = s.kind; p.orient = s.orient;
    state.pieces.set(p.id, p);
  }

  state.markers.clear();
  for (const s of snap.markers ?? []) {
    const m = new MarkerState();
    m.id = s.id; m.kind = s.kind; m.label = s.label; m.value = s.value; m.x = s.x; m.z = s.z;
    m.lockedBy = ''; m.attachedTo = s.attachedTo; m.ox = s.ox; m.oz = s.oz; m.order = s.order; m.rolls = s.rolls;
    state.markers.set(m.id, m);
  }

  state.notes.clear();
  for (const s of snap.notes ?? []) {
    const n = new NoteState();
    n.id = s.id; n.text = s.text; n.author = s.author; n.x = s.x; n.z = s.z; n.lockedBy = ''; n.order = s.order;
    state.notes.set(n.id, n);
  }

  state.counterNames.clear();
  for (const name of snap.counterNames ?? []) state.counterNames.push(name);
  for (const player of state.players.values()) {
    const row = snap.counters?.[player.id];
    player.counters.clear();
    for (const name of state.counterNames) player.counters.set(name, row?.[name] ?? 0);
  }

  const look = snap.look;
  if (look) {
    state.lookFelt = look.felt; state.lookImage = look.image;
    state.lookBackdrop = look.backdrop; state.lookAtmosphere = look.atmosphere;
  }
  state.gridSize = typeof snap.gridSize === 'number' && Number.isFinite(snap.gridSize) ? Math.max(0, Math.min(12, snap.gridSize)) : 0;
  return true;
}

/** Bounded past/future stacks of snapshots. Newest entry is last. */
export class History {
  private past: string[] = [];
  private future: string[] = [];
  private bytes = 0;

  get undoCount() { return this.past.length; }
  get redoCount() { return this.future.length; }

  /** Files `before` as an undo step and drops any redo branch (the usual undo-tree rule). */
  record(before: string) {
    for (const dropped of this.future) this.bytes -= dropped.length;
    this.future = [];
    this.past.push(before);
    this.bytes += before.length;
    this.trim();
  }

  /** Swaps the current state for the previous step; returns the snapshot to restore, or null. */
  back(current: string): string | null {
    const previous = this.past.pop();
    if (previous === undefined) return null;
    this.bytes -= previous.length;
    this.future.push(current);
    this.bytes += current.length;
    this.trim();
    return previous;
  }

  /** Swaps the current state for the next step; returns the snapshot to restore, or null. */
  forward(current: string): string | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.bytes -= next.length;
    this.past.push(current);
    this.bytes += current.length;
    this.trim();
    return next;
  }

  private trim() {
    while (this.past.length > MAX_UNDO_STEPS || (this.bytes > MAX_HISTORY_BYTES && this.past.length > 1)) {
      const dropped = this.past.shift();
      if (dropped === undefined) break;
      this.bytes -= dropped.length;
    }
    while (this.future.length > MAX_UNDO_STEPS) {
      const dropped = this.future.pop();
      if (dropped === undefined) break;
      this.bytes -= dropped.length;
    }
  }
}
