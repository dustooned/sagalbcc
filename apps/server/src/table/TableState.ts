// The synchronized table. Clients rebuild these types via schema reflection, so they only live here.
import { schema, t, type SchemaType } from '@colyseus/schema';

export const PieceState = schema({
  id: t.string().default(''),
  ownerId: t.string().default(''),
  x: t.float32().default(0),
  z: t.float32().default(0),
  /** Physical footprint in inches — copied from the definition so hit-testing/stacking never
   * needs a lookup, and mixed card/piece/board sizes all clamp/snap correctly. */
  w: t.float32().default(1),
  h: t.float32().default(1),
  rotation: t.int16().default(0),
  /** Meaningful for cards (front vs. generated/uploaded back); pieces and boards stay face-up. */
  faceUp: t.boolean().default(true),
  tapped: t.boolean().default(false),
  /** Stacking order: higher draws on top. Bumped whenever a piece is grabbed or moved. */
  order: t.uint32().default(0),
  lockedBy: t.string().default(''),
  /** Pinned to the table: nobody can grab, move, turn, flip, resize or delete it until somebody
   *  unlocks it. Unlike `lockedBy` (a transient "being dragged by" marker) this persists. */
  locked: t.boolean().default(false),
  /** JSON PieceFace. Nothing on this table is hidden information, so this is always populated. */
  face: t.string().default(''),
  backImage: t.string().default(''),
  kind: t.string().default('card'),
  /** 3D models only: which of the model's 6 sides faces up (0 = as exported). Fixes models that
   *  arrive upside down or lying on their side. */
  orient: t.uint8().default(0),
}, 'Piece');
export type PieceState = SchemaType<typeof PieceState>;

export const PlayerState = schema({
  id: t.string().default(''),
  name: t.string().default(''),
  /** 0..MAX_PLAYERS-1 for a seated player; -1 for a spectator (who holds no seat). */
  seat: t.int8().default(0),
  connected: t.boolean().default(true),
  /** Point counters (TTS-style), keyed by the table's counterNames. */
  counters: t.map('number'),
  /** Presence: where this player is pointing on the felt. `pointerAt` is a server-stamped tick
   *  (ms, wrapped to uint32) that changes on every update — clients watch it change rather than
   *  compare it to their own clock. 0 = pointer hidden. */
  pointerX: t.float32().default(0),
  pointerZ: t.float32().default(0),
  pointerAt: t.uint32().default(0),
  /** A one-off "look here" pulse at (pingX, pingZ); `pingAt` changes on every ping. 0 = never. */
  pingX: t.float32().default(0),
  pingZ: t.float32().default(0),
  pingAt: t.uint32().default(0),
  /** Watching without a seat: read-only, never host, doesn't count toward the 8 seats. */
  spectator: t.boolean().default(false),
  /** Co-host: may kick, ban and clear the table alongside the host. Session state — never undone. */
  promoted: t.boolean().default(false),
}, 'Player');
export type PlayerState = SchemaType<typeof PlayerState>;

/** A generic token (+1, −1, damage, status, custom). Dropped on a piece, it rides along with it. */
export const MarkerState = schema({
  id: t.string().default(''),
  kind: t.string().default('plus'),
  label: t.string().default(''),
  value: t.int16().default(1),
  x: t.float32().default(0),
  z: t.float32().default(0),
  lockedBy: t.string().default(''),
  /** Piece this marker sits on ('' = loose on the table); ox/oz = offset from that piece's centre. */
  attachedTo: t.string().default(''),
  ox: t.float32().default(0),
  oz: t.float32().default(0),
  order: t.uint32().default(0),
  /** Bumped on every roll, so a die visibly tumbles even when it lands on the same number. */
  rolls: t.uint16().default(0),
}, 'Marker');
export type MarkerState = SchemaType<typeof MarkerState>;

/** A tester's sticky note on the table ("maybe this should cost 2?"). */
export const NoteState = schema({
  id: t.string().default(''),
  text: t.string().default(''),
  author: t.string().default(''),
  x: t.float32().default(0),
  z: t.float32().default(0),
  lockedBy: t.string().default(''),
  order: t.uint32().default(0),
}, 'Note');
export type NoteState = SchemaType<typeof NoteState>;

export const TableState = schema({
  roomCode: t.string().default(''),
  hostId: t.string().default(''),
  pieces: t.map(PieceState),
  players: t.map(PlayerState),
  log: t.array('string'),
  markers: t.map(MarkerState),
  notes: t.map(NoteState),
  /** Shared table look: felt color, plus an optional uploaded image laid over it. */
  lookFelt: t.string().default('#184554'),
  lookImage: t.string().default(''),
  /** JSON Backdrop — what's behind the table (space, nebula, gradient, image…). '' = default. */
  lookBackdrop: t.string().default(''),
  /** JSON Atmosphere — fog, dust, rain, snow or embers over the table. '' = none. */
  lookAtmosphere: t.string().default(''),
  /** Counter columns every player gets (SCORE, HP, GOLD…). Anyone can add or remove one. */
  counterNames: t.array('string'),
  /** Inches between grid lines that dropped pieces snap to. 0 = no grid. */
  gridSize: t.float32().default(0),
  /** How many steps Ctrl+Z / Ctrl+Shift+Z would take — so the menus can grey out when empty.
   *  These are a view of the server's history stack, not part of the snapshot it stores. */
  undoCount: t.uint8().default(0),
  redoCount: t.uint8().default(0),
  /** Lowercased names the host or a co-host banned. Session state: deliberately left out of undo
   *  snapshots and save files, so neither an undo nor a loaded table can let a banned name back in. */
  bans: t.array('string'),
}, 'TableState');
export type TableState = SchemaType<typeof TableState>;
