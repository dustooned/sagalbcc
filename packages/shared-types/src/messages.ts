// Every room message, by name. The server validates structure only — never game legality.
import type { NormalizedKit, PieceDefinition } from './pieces.ts';

export interface ClientMessages {
  grab: { id: string };
  move: { id: string; x: number; z: number };
  drop: { id: string; x: number; z: number; snap?: boolean };
  grabMany: { ids: string[] };
  moveMany: { items: { id: string; x: number; z: number }[] };
  dropMany: { items: { id: string; x: number; z: number }[] };
  stackAction: { id: string; action: StackAction };
  flip: { ids: string[] };
  rotate: { ids: string[]; delta: 90 | -90 | 15 | -15 | 180 };
  /** Scale pieces by a factor (0.5–2 per step), kept between 0.4" and 30" on the long side. */
  resize: { ids: string[]; factor: number };
  tap: { ids: string[] };
  /** 3D models: cycle which side faces up (dir -1 = back one step). */
  orient: { ids: string[]; dir?: 1 | -1; /** Jump straight to one of the 6 sides instead of stepping. */ set?: number };
  /** Turn every piece face up (true) or face down (false), instead of toggling like flip. */
  setFace: { ids: string[]; faceUp: boolean };
  /** Pull pieces onto the first one's spot as one stack (shuffled if asked). */
  gather: { ids: string[]; shuffle?: boolean };
  clone: { id: string };
  remove: { ids: string[] };
  /** Pin pieces to the table so nobody can move them, or unpin them again. */
  setLock: { ids: string[]; locked: boolean };
  /** Step the whole table back / forward one action. Anyone at the table may do it; the log
   *  records who did, and the server keeps the depth in `undoCount` / `redoCount`. */
  undo: Record<string, never>;
  redo: Record<string, never>;
  /** Ask the server for this table as a downloadable save file (it replies with `tableSaved`). */
  saveTable: Record<string, never>;
  /** Replace the table with a save file the tester picked. Undoable, like any other action. */
  loadTable: { json: string };
  /** Grid that loose pieces snap to when dropped, in inches. 0 turns it off. */
  setGrid: { size: number };
  /** Rename a piece and/or set the description shown in its menu. Undefined = leave alone. */
  setPieceInfo: { ids: string[]; name?: string; description?: string };
  /** Bring back the newest autosave, when the table offered one on joining. Undoable too. */
  restoreAutosave: Record<string, never>;
  /** Spawns every piece in the kit onto the table (scattered, boards centered). Replaces nothing —
   * loading twice just adds more pieces, so a host can bring in several kits at once if they want. */
  loadKit: { kit: NormalizedKit; definitions: PieceDefinition[] };
  spawnMarker: { kind: MarkerKind; label?: string; x?: number; z?: number };
  adjustMarker: { id: string; delta: number };
  renameMarker: { id: string; label: string };
  /** Re-rolls a 'die' marker to a fresh random 1-6. No-op on any other marker kind. */
  rollMarker: { id: string };
  /** A player's point counter: add delta, or set an exact value. */
  counter: { playerId: string; key: string; delta?: number; value?: number };
  addCounter: { name: string };
  removeCounter: { name: string };
  renameCounter: { from: string; to: string };
  addNote: { text: string; x?: number; z?: number };
  editNote: { id: string; text: string };
  resetTable: Record<string, never>;
  /** Shared table surface: felt color and/or an uploaded /uploads/... image ('' removes it). */
  setTableLook: { felt?: string; image?: string; backdrop?: import('./table.ts').Backdrop; atmosphere?: import('./table.ts').Atmosphere };
  /** Host or co-host: remove a player (they may rejoin). */
  kick: { playerId: string };
  /** Host or co-host: remove a player and ban their name from rejoining this table. */
  ban: { playerId: string };
  unban: { name: string };
  /** Host only: make a seated player a co-host (may kick, ban and clear), or undo that. */
  promote: { playerId: string; promoted: boolean };
  /** Latency probe — not to be confused with `pointerPing`. */
  ping: { t: number };
  /** Presence: where you're pointing on the felt. Omit both coordinates to hide your pointer.
   *  High-frequency and not part of the table: never undoable, never logged. */
  point: { x?: number; z?: number };
  /** A one-off pulse at a spot ("look here"). Not undoable, not logged. */
  pointerPing: { x: number; z: number };
}

export interface ServerMessages {
  welcome: { playerId: string; roomCode: string };
  notice: { text: string };
  pong: { t: number };
  kicked: { text: string };
  /** A finished save file, ready to hand to the browser as a download. */
  tableSaved: { json: string; filename: string };
  /** A recent autosave is on disk; the first player at a fresh table may bring it back. */
  resumable: { roomCode: string; savedAt: string; pieces: number; markers: number; notes: number };
}

export type StackAction = 'shuffle' | 'flip' | 'spread';
export type MarkerKind = 'plus' | 'minus' | 'damage' | 'status' | 'custom' | 'die' | 'diePips' | 'd4' | 'd8' | 'd10' | 'd12' | 'd20';
/** Every marker kind that's actually a die — a tap/rollMarker re-rolls it. */
export const DIE_KINDS: readonly MarkerKind[] = ['die', 'diePips', 'd4', 'd8', 'd10', 'd12', 'd20'];
/** How many sides each die kind has (6 for the two d6 variants). */
export const DIE_SIDES: Partial<Record<MarkerKind, number>> = { die: 6, diePips: 6, d4: 4, d8: 8, d10: 10, d12: 12, d20: 20 };

/** Options sent with create/join. */
export interface JoinOptions {
  token: string;
  name: string;
  /** Lets a player take back their own disconnected seat after a refresh. */
  reclaimPlayerId?: string;
  /** Watch without taking a seat: read-only, and doesn't use up one of the table's seats. */
  spectate?: boolean;
}

/** HTTP API shapes. */
export interface AuthResponse { token: string; expiresAt: number }
export interface UploadResponse { assetUrl: string }
