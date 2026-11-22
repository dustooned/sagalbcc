// A preview of the server's drop-snap rule (see `drop()` in tableOps.ts): the nearest piece of
// the same kind, not held by somebody else, within 40% of the dragged piece's smaller side. The
// server still decides where a piece actually lands — this only shows you the target before you
// let go, so a snap reads as "it slid into place" instead of "it teleported".
import type { SyncedPiece } from '../net/stateTypes.ts';

export interface DraggedPiece {
  id: string;
  x: number;
  z: number;
  kind: string;
  w: number;
  h: number;
}

export function snapTargetFor(dragged: DraggedPiece, others: Iterable<SyncedPiece>, playerId: string): string | null {
  const radius = Math.min(dragged.w, dragged.h) * 0.4;
  let best: string | null = null;
  let bestDistance = radius;
  for (const other of others) {
    // Same three rules the server applies, in the same order.
    if (other.id === dragged.id || other.kind !== dragged.kind) continue;
    if (other.lockedBy && other.lockedBy !== playerId) continue;
    const distance = Math.hypot(other.x - dragged.x, other.z - dragged.z);
    if (distance < bestDistance) { best = other.id; bestDistance = distance; }
  }
  return best;
}
