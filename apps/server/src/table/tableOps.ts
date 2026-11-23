// Every table operation as a plain function over (state + server-private data). The room wires
// these to messages; tests can call them directly. Nothing here is a game rule — only "does this
// piece exist, who is holding it, is this data well-formed". Nothing on this table is hidden
// information either (no private hands/decks), so a piece's face is always visible to everyone;
// faceUp only switches which image (front or back) is shown.
import { randomInt } from 'node:crypto';
import {
  ATMOSPHERE_KINDS, BACKDROP_EFFECTS, BACKDROP_MODES, DEFAULT_FELT, DIE_KINDS, DIE_SIDES, MAX_BANS, MAX_COUNTERS, MAX_PLAYERS, MAX_SPECTATORS, clampToTable,
  type MarkerKind, type NormalizedKit, type PieceDefinition, type PieceFace, type PieceKind,
} from '@kitforge/shared-types';
import { MarkerState, NoteState, PieceState, PlayerState, TableState } from './TableState.ts';
import { History, restoreSnapshot, snapshotOf, type TableSnapshot } from './history.ts';
import { cleanImageUrl, cleanText, isFiniteNumber, sanitizeFace } from './sanitize.ts';

export interface TableContext {
  state: TableState;
  nextOrder: number;
  nextId: number;
  randomInt: (maxExclusive: number) => number;
  /** Undo/redo steps. Not part of the synced table except for the two depth counters it feeds. */
  history: History;
}

export interface OpResult { ok: boolean; notice?: string }
const ok = (): OpResult => ({ ok: true });
const fail = (notice?: string): OpResult => ({ ok: false, notice });

export function createTableContext(opts: Partial<Pick<TableContext, 'randomInt'>> = {}): TableContext {
  return { state: withDefaults(new TableState()), nextOrder: 1, nextId: 1, randomInt: opts.randomInt ?? (n => randomInt(n)), history: new History() };
}

// ---------------------------------------------------------------- helpers

function withDefaults(state: TableState) { state.counterNames.push('SCORE'); return state; }

export function appendLog(ctx: TableContext, text: string) {
  ctx.state.log.push(text);
  while (ctx.state.log.length > 150) ctx.state.log.shift();
}

const nameOf = (ctx: TableContext, playerId: string) => ctx.state.players.get(playerId)?.name ?? 'Someone';
const faceOf = (piece: PieceState): PieceFace | null => { try { return piece.face ? (JSON.parse(piece.face) as PieceFace) : null; } catch { return null; } };
const labelOf = (piece: PieceState) => faceOf(piece)?.name ?? 'a piece';
const lockedByOther = (item: { lockedBy: string }, playerId: string) => !!item.lockedBy && item.lockedBy !== playerId;
/** Pinned by a player: immovable for everybody until somebody unlocks it. */
const LOCKED_NOTICE = 'That piece is locked. Unlock it first (K).';

// ---------------------------------------------------------------- undo / redo

function syncHistoryCounts(ctx: TableContext) {
  ctx.state.undoCount = Math.min(255, ctx.history.undoCount);
  ctx.state.redoCount = Math.min(255, ctx.history.redoCount);
}

/** Runs one discrete action with a single undo step behind it. Drags are deliberately not
 *  wrapped: `grab` opens the step and the `move`s and `drop` mutate inside it, so one Ctrl+Z
 *  undoes a whole move instead of one packet of it. */
export function undoable(ctx: TableContext, fn: () => OpResult): OpResult {
  const before = snapshotOf(ctx.state);
  const res = fn();
  if (res.ok) { ctx.history.record(before); syncHistoryCounts(ctx); }
  return res;
}

export function undo(ctx: TableContext, playerId: string): OpResult {
  const previous = ctx.history.back(snapshotOf(ctx.state));
  if (previous === null) return fail('Nothing to undo.');
  restoreSnapshot(ctx.state, previous);
  syncHistoryCounts(ctx);
  appendLog(ctx, `${nameOf(ctx, playerId)} undid an action.`);
  return ok();
}

export function redo(ctx: TableContext, playerId: string): OpResult {
  const next = ctx.history.forward(snapshotOf(ctx.state));
  if (next === null) return fail('Nothing to redo.');
  restoreSnapshot(ctx.state, next);
  syncHistoryCounts(ctx);
  appendLog(ctx, `${nameOf(ctx, playerId)} redid an action.`);
  return ok();
}

function bump(ctx: TableContext, piece: PieceState) { piece.order = ctx.nextOrder++; }

function lockNotice(ctx: TableContext, item: { lockedBy: string }, what = 'piece') {
  return `${nameOf(ctx, item.lockedBy)} is moving that ${what}.`;
}

interface NewPiece { ownerId: string; face: PieceFace; x?: number; z?: number; rotation?: number; faceUp?: boolean }

export function createPiece(ctx: TableContext, spec: NewPiece): PieceState {
  const piece = new PieceState();
  piece.id = `p${ctx.nextId++}`;
  piece.ownerId = spec.ownerId;
  piece.kind = spec.face.kind;
  piece.w = spec.face.w;
  piece.h = spec.face.h;
  const pos = clampToTable(spec.x ?? 0, spec.z ?? 0, piece.w, piece.h);
  piece.x = pos.x;
  piece.z = pos.z;
  piece.rotation = spec.rotation ?? 0;
  piece.faceUp = spec.faceUp ?? true;
  piece.tapped = false;
  piece.lockedBy = '';
  piece.backImage = spec.face.backImage ?? '';
  piece.face = JSON.stringify(spec.face);
  bump(ctx, piece);
  ctx.state.pieces.set(piece.id, piece);
  return piece;
}

/** Topmost piece on the table covering this point (rotation- and size-aware). */
function pieceUnder(ctx: TableContext, x: number, z: number, exclude?: string): PieceState | undefined {
  let best: PieceState | undefined;
  for (const p of ctx.state.pieces.values()) {
    if (p.id === exclude) continue;
    const yaw = ((p.rotation - (p.tapped ? 90 : 0)) * Math.PI) / 180;
    const dx = x - p.x, dz = z - p.z;
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw), lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    if (Math.abs(lx) <= p.w / 2 && Math.abs(lz) <= p.h / 2 && (!best || p.order > best.order)) best = p;
  }
  return best;
}

function detachMarker(ctx: TableContext, marker: MarkerState) {
  const piece = marker.attachedTo ? ctx.state.pieces.get(marker.attachedTo) : undefined;
  if (piece) {
    const pos = clampToTable(piece.x + marker.ox, piece.z + marker.oz);
    marker.x = pos.x;
    marker.z = pos.z;
  }
  marker.attachedTo = '';
}

function detachMarkers(ctx: TableContext, piece: PieceState) {
  for (const m of ctx.state.markers.values()) if (m.attachedTo === piece.id) detachMarker(ctx, m);
}

function deletePiece(ctx: TableContext, piece: PieceState) {
  detachMarkers(ctx, piece);
  ctx.state.pieces.delete(piece.id);
}

function shuffleInPlace<T>(ctx: TableContext, list: T[]) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = ctx.randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
}

// ---------------------------------------------------------------- players

export interface JoinResult { player?: PlayerState; reclaimed?: boolean; error?: string }

/** How a name is stored in, and compared against, the ban list. */
const banKey = (name: string) => name.toLowerCase().slice(0, 24);

export function addPlayer(ctx: TableContext, opts: { name: unknown; reclaimPlayerId?: unknown; newId: string; spectate?: unknown }): JoinResult {
  const players = [...ctx.state.players.values()];
  const spectate = opts.spectate === true;
  const name = cleanText(opts.name, 24) || `Player ${players.length + 1}`;
  // Checked before anything else — a banned name can't reclaim an old seat either.
  if (ctx.state.bans.includes(banKey(name))) return { error: `The name "${name}" has been banned from this table by the host.` };
  // Only take back a row of the same kind: a spectator must never land in a seated player's
  // row (or the reverse) just because the names match.
  const byId = typeof opts.reclaimPlayerId === 'string' ? ctx.state.players.get(opts.reclaimPlayerId) : undefined;
  const reclaim = (byId && !byId.connected && byId.spectator === spectate ? byId : undefined)
    ?? players.find(p => !p.connected && p.spectator === spectate && p.name.toLowerCase() === name.toLowerCase());
  if (reclaim) {
    reclaim.connected = true;
    appendLog(ctx, `${reclaim.name} reconnected.`);
    return { player: reclaim, reclaimed: true };
  }
  let seat = -1;
  if (spectate) {
    if (players.filter(p => p.spectator).length >= MAX_SPECTATORS) return { error: `This table already has ${MAX_SPECTATORS} spectators watching.` };
  } else {
    const used = new Set(players.filter(p => !p.spectator).map(p => p.seat));
    for (let s = 0; s < MAX_PLAYERS; s++) if (!used.has(s)) { seat = s; break; }
    if (seat < 0) return { error: `The table is full (${MAX_PLAYERS} seats). You can still watch without a seat, or the host can remove a disconnected player to free one.` };
  }
  const player = new PlayerState();
  player.id = opts.newId;
  player.name = name;
  player.seat = seat;
  player.connected = true;
  player.spectator = spectate;
  for (const k of ctx.state.counterNames) player.counters.set(k, 0);
  ctx.state.players.set(player.id, player);
  // A spectator never hosts; a table opened by a spectator gets its host when someone sits down.
  if (!ctx.state.hostId && !spectate) ctx.state.hostId = player.id;
  appendLog(ctx, spectate ? `${name} is watching the table.` : `${name} joined the table.`);
  return { player };
}

/** A spectator whose connection is gone for good simply leaves — they hold no seat, no pieces
 *  and no counters worth coming back to. Returns true if a row was removed. */
export function dropSpectator(ctx: TableContext, playerId: string): boolean {
  const p = ctx.state.players.get(playerId);
  if (!p?.spectator) return false;
  ctx.state.players.delete(playerId);
  return true;
}

export function releaseLocks(ctx: TableContext, playerId: string) {
  const all = [...ctx.state.pieces.values(), ...ctx.state.markers.values(), ...ctx.state.notes.values()];
  for (const item of all) if (item.lockedBy === playerId) item.lockedBy = '';
}

export function setConnected(ctx: TableContext, playerId: string, connected: boolean) {
  const p = ctx.state.players.get(playerId);
  if (!p) return;
  p.connected = connected;
  if (!connected) { releaseLocks(ctx, playerId); p.pointerAt = 0; }
}

/** Only a seated, connected player can become host — never a spectator. */
export function reassignHost(ctx: TableContext) {
  const host = ctx.state.players.get(ctx.state.hostId);
  if (host?.connected && !host.spectator) return;
  const next = [...ctx.state.players.values()]
    .filter(p => p.connected && !p.spectator && p.seat >= 0)
    .sort((a, b) => a.seat - b.seat)[0];
  if (next && next.id !== ctx.state.hostId) {
    ctx.state.hostId = next.id;
    appendLog(ctx, `${next.name} is now the host.`);
  }
}

/** Host or co-host. A spectator is never promoted, so this never lets one through. */
export function isStaff(ctx: TableContext, actorId: string): boolean {
  return !!actorId && (actorId === ctx.state.hostId || ctx.state.players.get(actorId)?.promoted === true);
}

/** Shared by kick and ban: who may be removed, and by whom. Nobody removes themselves or the host. */
function removable(ctx: TableContext, actorId: string, targetId: unknown, verb: string): PlayerState | OpResult {
  if (!isStaff(ctx, actorId)) return fail(`Only the host or a co-host can ${verb} players.`);
  if (typeof targetId !== 'string' || targetId === actorId) return fail();
  const target = ctx.state.players.get(targetId);
  if (!target) return fail();
  if (targetId === ctx.state.hostId) return fail(`The host can't be ${verb === 'ban' ? 'banned' : 'removed'}.`);
  return target;
}

function removePlayer(ctx: TableContext, target: PlayerState) {
  releaseLocks(ctx, target.id);
  ctx.state.players.delete(target.id);
}

export function kick(ctx: TableContext, actorId: string, targetId: unknown): OpResult {
  const target = removable(ctx, actorId, targetId, 'remove');
  if ('ok' in target) return target;
  removePlayer(ctx, target);
  appendLog(ctx, `${nameOf(ctx, actorId)} removed ${target.name} from the table.`);
  return ok();
}

/** Removes a player and bans their name from rejoining this table.
 *
 *  This is a name-based ban and it is trivially spoofable: anyone can rejoin under a different
 *  name. It is a classroom convenience behind the table's shared password, not a security
 *  boundary — the password is the boundary. Bans are session state: they are not in undo
 *  snapshots or save files, so no undo or loaded table can lift one. */
export function ban(ctx: TableContext, actorId: string, targetId: unknown): OpResult {
  const target = removable(ctx, actorId, targetId, 'ban');
  if ('ok' in target) return target;
  const key = banKey(target.name);
  if (!ctx.state.bans.includes(key)) {
    if (ctx.state.bans.length >= MAX_BANS) return fail(`The ban list is full (${MAX_BANS}). Unban someone first.`);
    ctx.state.bans.push(key);
  }
  removePlayer(ctx, target);
  appendLog(ctx, `${nameOf(ctx, actorId)} banned ${target.name} from the table.`);
  return ok();
}

export function unban(ctx: TableContext, actorId: string, name: unknown): OpResult {
  if (!isStaff(ctx, actorId)) return fail('Only the host or a co-host can unban players.');
  const key = banKey(cleanText(name, 24));
  const i = ctx.state.bans.indexOf(key);
  if (!key || i < 0) return fail('That name is not banned.');
  ctx.state.bans.splice(i, 1);
  appendLog(ctx, `${nameOf(ctx, actorId)} lifted the ban on "${key}".`);
  return ok();
}

/** Host only: make a seated player a co-host, or take it away (the host may demote themselves
 *  too). There is still exactly one host — promotion never touches hostId. Permission state, so
 *  callers must not wrap this in `undoable`. */
export function promote(ctx: TableContext, actorId: string, targetId: unknown, promoted: unknown): OpResult {
  if (actorId !== ctx.state.hostId) return fail('Only the host can choose co-hosts.');
  if (typeof promoted !== 'boolean' || typeof targetId !== 'string') return fail();
  const target = ctx.state.players.get(targetId);
  if (!target) return fail();
  if (promoted && target.spectator) return fail('Spectators can’t be co-hosts. They need to join with a seat first.');
  if (target.promoted === promoted) return ok();
  target.promoted = promoted;
  appendLog(ctx, promoted
    ? `${nameOf(ctx, actorId)} made ${target.name} a co-host.`
    : `${nameOf(ctx, actorId)} removed ${target.name} as co-host.`);
  return ok();
}

// ---------------------------------------------------------------- presence (pointers)
//
// Pointers and pings are presence, not table state: they are never undoable and never logged,
// and they are high-frequency, so the room's token bucket is their only rate limit.

/** A uint32 tick that is never 0 (0 means hidden) and always differs from the last one, so a
 *  client can tell an update happened even when two land in the same millisecond. Wraps every
 *  ~49 days; clients only watch it change, never compare it to their own clock. */
function tick(now: number, previous: number): number {
  let t = (Math.floor(now) >>> 0) || 1;
  if (t === previous) t = ((t + 1) >>> 0) || 1;
  return t;
}

/** Your pointer on the felt; omit both coordinates to hide it. Clamped to the table's edge. */
export function setPointer(ctx: TableContext, playerId: string, x: unknown, z: unknown, now = Date.now()): OpResult {
  const p = ctx.state.players.get(playerId);
  if (!p) return fail();
  if (x === undefined && z === undefined) { p.pointerAt = 0; return ok(); }
  if (!isFiniteNumber(x) || !isFiniteNumber(z)) return fail();
  const at = clampToTable(x, z, 0, 0);
  p.pointerX = at.x;
  p.pointerZ = at.z;
  p.pointerAt = tick(now, p.pointerAt);
  return ok();
}

/** A one-off pulse at a spot on the felt. */
export function pingPointer(ctx: TableContext, playerId: string, x: unknown, z: unknown, now = Date.now()): OpResult {
  const p = ctx.state.players.get(playerId);
  if (!p || !isFiniteNumber(x) || !isFiniteNumber(z)) return fail();
  const at = clampToTable(x, z, 0, 0);
  p.pingX = at.x;
  p.pingZ = at.z;
  p.pingAt = tick(now, p.pingAt);
  return ok();
}

// ---------------------------------------------------------------- dragging

type Movable = { kind: 'piece'; item: PieceState } | { kind: 'marker'; item: MarkerState } | { kind: 'note'; item: NoteState };
function movable(ctx: TableContext, id: unknown): Movable | undefined {
  if (typeof id !== 'string') return undefined;
  const piece = ctx.state.pieces.get(id);
  if (piece) return { kind: 'piece', item: piece };
  const marker = ctx.state.markers.get(id);
  if (marker) return { kind: 'marker', item: marker };
  const note = ctx.state.notes.get(id);
  return note ? { kind: 'note', item: note } : undefined;
}

export function grab(ctx: TableContext, playerId: string, id: unknown): OpResult {
  const m = movable(ctx, id);
  if (!m) return fail('That is no longer there.');
  if (m.kind === 'piece' && m.item.locked) return fail(LOCKED_NOTICE);
  if (lockedByOther(m.item, playerId)) return fail(lockNotice(ctx, m.item, m.kind));
  if (m.kind === 'marker') detachMarker(ctx, m.item);
  m.item.lockedBy = playerId;
  m.item.order = ctx.nextOrder++;
  return ok();
}

export function move(ctx: TableContext, playerId: string, id: unknown, x: unknown, z: unknown): OpResult {
  const m = movable(ctx, id);
  if (!m || m.item.lockedBy !== playerId || !isFiniteNumber(x) || !isFiniteNumber(z)) return fail();
  const pos = clampToTable(x, z, m.kind === 'piece' ? m.item.w : undefined, m.kind === 'piece' ? m.item.h : undefined);
  m.item.x = pos.x;
  m.item.z = pos.z;
  return ok();
}

function dropLoose(ctx: TableContext, playerId: string, m: Exclude<Movable, { kind: 'piece' }>, x: unknown, z: unknown): OpResult {
  if (lockedByOther(m.item, playerId)) return fail(lockNotice(ctx, m.item, m.kind));
  if (isFiniteNumber(x) && isFiniteNumber(z)) {
    const pos = clampToTable(x, z);
    m.item.x = pos.x;
    m.item.z = pos.z;
  }
  m.item.lockedBy = '';
  m.item.order = ctx.nextOrder++;
  if (m.kind === 'marker') {
    const piece = pieceUnder(ctx, m.item.x, m.item.z);
    if (piece) { m.item.attachedTo = piece.id; m.item.ox = m.item.x - piece.x; m.item.oz = m.item.z - piece.z; }
  }
  return ok();
}

/** Cards this close together count as one stack. Scales gently with the smaller card's size. */
const SAME_SPOT = 0.06;

export function drop(ctx: TableContext, playerId: string, id: unknown, x: unknown, z: unknown, snap = true): OpResult {
  const m = movable(ctx, id);
  if (m && m.kind !== 'piece') return dropLoose(ctx, playerId, m, x, z);
  const piece = m?.item;
  if (!piece) return fail();
  if (piece.locked) return fail(LOCKED_NOTICE);
  if (lockedByOther(piece, playerId)) return fail(lockNotice(ctx, piece));
  if (isFiniteNumber(x) && isFiniteNumber(z)) {
    const pos = clampToTable(x, z, piece.w, piece.h);
    piece.x = pos.x;
    piece.z = pos.z;
  }
  if (snap) {
    // Grid first, then the same-kind snap: a piece lands on a grid line, and can still click onto
    // a pile that happens to sit near one.
    const grid = ctx.state.gridSize;
    if (grid > 0) {
      const aligned = clampToTable(Math.round(piece.x / grid) * grid, Math.round(piece.z / grid) * grid, piece.w, piece.h);
      piece.x = aligned.x;
      piece.z = aligned.z;
    }
    const snapDist = Math.min(piece.w, piece.h) * 0.4;
    let best: PieceState | undefined, bestDist = snapDist;
    for (const other of ctx.state.pieces.values()) {
      if (other === piece || other.kind !== piece.kind || lockedByOther(other, playerId)) continue;
      const d = Math.hypot(other.x - piece.x, other.z - piece.z);
      if (d < bestDist) { best = other; bestDist = d; }
    }
    if (best) { piece.x = best.x; piece.z = best.z; }
  }
  piece.lockedBy = '';
  bump(ctx, piece);
  return ok();
}

type MoveItem = { id?: unknown; x?: unknown; z?: unknown };
const items = (v: unknown): MoveItem[] => (Array.isArray(v) ? v.slice(0, 80).filter(i => typeof i === 'object' && i !== null) : []);

export function grabMany(ctx: TableContext, playerId: string, ids: string[]): OpResult {
  const results = ids.map(id => grab(ctx, playerId, id));
  return results.some(r => r.ok) ? ok() : fail(results.find(r => r.notice)?.notice);
}
export function moveMany(ctx: TableContext, playerId: string, list: unknown): OpResult {
  for (const i of items(list)) move(ctx, playerId, i.id, i.x, i.z);
  return ok();
}
export function dropMany(ctx: TableContext, playerId: string, list: unknown): OpResult {
  for (const i of items(list)) drop(ctx, playerId, i.id, i.x, i.z, false);
  return ok();
}

// ---------------------------------------------------------------- stacks

/** Every piece sharing this piece's spot and kind, bottom first. */
export function stackOf(ctx: TableContext, piece: PieceState): PieceState[] {
  return [...ctx.state.pieces.values()]
    .filter(p => p.kind === piece.kind && Math.abs(p.x - piece.x) < SAME_SPOT && Math.abs(p.z - piece.z) < SAME_SPOT)
    .sort((a, b) => a.order - b.order);
}

export function stackAction(ctx: TableContext, playerId: string, id: unknown, action: unknown): OpResult {
  const piece = typeof id === 'string' ? ctx.state.pieces.get(id) : undefined;
  if (!piece) return fail();
  const stack = stackOf(ctx, piece);
  if (stack.length < 2) return fail('That is not in a stack.');
  const blocked = stack.find(c => lockedByOther(c, playerId));
  if (stack.some(c => c.locked)) return fail('Part of that stack is locked. Unlock it first (K).');
  if (blocked) return fail(lockNotice(ctx, blocked));
  const orders = stack.map(c => c.order);
  const who = nameOf(ctx, playerId), n = stack.length;

  if (action === 'shuffle') {
    const mixed = [...stack];
    shuffleInPlace(ctx, mixed);
    mixed.forEach((c, i) => { c.order = orders[i]; });
    appendLog(ctx, `${who} shuffled a stack of ${n}.`);
  } else if (action === 'flip') {
    const faceUp = !stack[n - 1].faceUp;
    stack.forEach((c, i) => { c.faceUp = faceUp; c.order = orders[n - 1 - i]; });
    appendLog(ctx, `${who} flipped a stack of ${n} ${faceUp ? 'face-up' : 'face-down'}.`);
  } else if (action === 'spread') {
    const base = { x: piece.x, z: piece.z };
    const gap = Math.max(0.5, piece.w * 0.45);
    stack.forEach((c, i) => {
      const pos = clampToTable(base.x + (i - (n - 1) / 2) * gap, base.z, c.w, c.h);
      c.x = pos.x; c.z = pos.z;
    });
    appendLog(ctx, `${who} spread out a stack of ${n}.`);
  } else return fail();
  return ok();
}

/** Pull pieces onto one spot as a single stack — the first id's spot, which is the piece the
 *  player right-clicked or pointed at. Shuffled, it's "shuffle these cards into a deck". */
export function gather(ctx: TableContext, playerId: string, ids: string[], shuffle: unknown): OpResult {
  const picked = ids.map(id => ctx.state.pieces.get(id)).filter((p): p is PieceState => !!p);
  const free = picked.filter(p => !p.locked && !lockedByOther(p, playerId));
  if (free.length < 2) {
    const blocked = picked.find(p => lockedByOther(p, playerId));
    return fail(blocked ? lockNotice(ctx, blocked) : 'Select two or more pieces first.');
  }
  const anchor = free[0];
  const pos = clampToTable(anchor.x, anchor.z, Math.max(...free.map(p => p.w)), Math.max(...free.map(p => p.h)));
  const pile = [...free].sort((a, b) => a.order - b.order);
  if (shuffle === true) shuffleInPlace(ctx, pile);
  for (const p of pile) { p.x = pos.x; p.z = pos.z; p.rotation = anchor.rotation; bump(ctx, p); }
  const what = pile.every(p => p.kind === 'card') ? 'cards' : 'pieces';
  appendLog(ctx, `${nameOf(ctx, playerId)} ${shuffle === true ? 'shuffled' : 'gathered'} ${pile.length} ${what} into a stack.`);
  return ok();
}

// ---------------------------------------------------------------- piece state

function eachPiece(ctx: TableContext, playerId: string, ids: string[], fn: (piece: PieceState) => void): OpResult {
  let changed = 0, blocked: PieceState | undefined, pinned = false;
  for (const id of ids) {
    const piece = ctx.state.pieces.get(id);
    if (!piece) continue;
    if (piece.locked) { pinned = true; continue; }
    if (lockedByOther(piece, playerId)) { blocked = piece; continue; }
    fn(piece);
    changed++;
  }
  if (!changed) return fail(blocked ? lockNotice(ctx, blocked) : pinned ? LOCKED_NOTICE : undefined);
  return ok();
}

export function setFace(ctx: TableContext, playerId: string, ids: string[], faceUp: unknown): OpResult {
  if (typeof faceUp !== 'boolean') return fail();
  let n = 0;
  const res = eachPiece(ctx, playerId, ids, piece => { if (piece.faceUp !== faceUp) { piece.faceUp = faceUp; n++; } });
  if (res.ok && n) appendLog(ctx, `${nameOf(ctx, playerId)} turned ${n === 1 ? 'a card' : `${n} cards`} face ${faceUp ? 'up' : 'down'}.`);
  return res;
}
export function flip(ctx: TableContext, playerId: string, ids: string[]): OpResult {
  const labels: string[] = [];
  const res = eachPiece(ctx, playerId, ids, piece => { piece.faceUp = !piece.faceUp; labels.push(piece.faceUp ? labelOf(piece) : 'a card face-down'); });
  if (res.ok) appendLog(ctx, `${nameOf(ctx, playerId)} flipped ${labels.length === 1 ? labels[0] : `${labels.length} cards`}.`);
  return res;
}
const ROTATE_STEPS = [90, -90, 15, -15, 180];
/** Smallest/largest a piece can be resized to, in inches (longer side). */
const MIN_SIDE = 0.4, MAX_SIDE = 30;

export function resize(ctx: TableContext, playerId: string, ids: string[], factor: unknown): OpResult {
  const f = typeof factor === 'number' && Number.isFinite(factor) ? Math.min(2, Math.max(0.5, factor)) : 1;
  if (f === 1) return fail();
  return eachPiece(ctx, playerId, ids, piece => {
    const long = Math.max(piece.w, piece.h);
    const k = Math.min(MAX_SIDE / long, Math.max(MIN_SIDE / long, f));
    piece.w *= k; piece.h *= k;
    const pos = clampToTable(piece.x, piece.z, piece.w, piece.h);
    piece.x = pos.x; piece.z = pos.z;
  });
}

export function rotate(ctx: TableContext, playerId: string, ids: string[], delta: unknown): OpResult {
  const d = ROTATE_STEPS.includes(delta as number) ? (delta as number) : 90;
  return eachPiece(ctx, playerId, ids, piece => { piece.rotation = (((piece.rotation + d) % 360) + 360) % 360; });
}
/** 3D models: step to the next of the 6 "which way is up" orientations. Cards/tokens ignore it. */
export function orient(ctx: TableContext, playerId: string, ids: string[], dir: unknown, set?: unknown): OpResult {
  const exact = typeof set === 'number' && Number.isInteger(set) && set >= 0 && set < 6 ? set : null;
  const step = dir === -1 ? 5 : 1;
  return eachPiece(ctx, playerId, ids, piece => { if (faceOf(piece)?.model) piece.orient = exact ?? (piece.orient + step) % 6; });
}
export function tap(ctx: TableContext, playerId: string, ids: string[]): OpResult {
  return eachPiece(ctx, playerId, ids, piece => { piece.tapped = !piece.tapped; });
}

export function clone(ctx: TableContext, playerId: string, id: unknown): OpResult {
  const piece = typeof id === 'string' ? ctx.state.pieces.get(id) : undefined;
  const face = piece && faceOf(piece);
  if (!piece || !face) return fail();
  const copy = createPiece(ctx, { ownerId: playerId, face: { ...face, w: piece.w, h: piece.h }, x: piece.x + Math.min(piece.w, 1) * 0.3, z: piece.z + Math.min(piece.h, 1) * 0.3, rotation: piece.rotation, faceUp: piece.faceUp });
  copy.orient = piece.orient;
  appendLog(ctx, `${nameOf(ctx, playerId)} cloned ${labelOf(copy)}.`);
  return ok();
}

export function remove(ctx: TableContext, playerId: string, ids: string[]): OpResult {
  let pieces = 0, other = 0, pinned = false;
  for (const id of ids) {
    const m = movable(ctx, id);
    if (!m || lockedByOther(m.item, playerId)) continue;
    if (m.kind === 'piece' && m.item.locked) { pinned = true; continue; }
    if (m.kind === 'piece') { deletePiece(ctx, m.item); pieces++; }
    else { (m.kind === 'marker' ? ctx.state.markers : ctx.state.notes).delete(id); other++; }
  }
  if (!pieces && !other) return fail(pinned ? LOCKED_NOTICE : undefined);
  if (pieces) appendLog(ctx, `${nameOf(ctx, playerId)} deleted ${pieces === 1 ? 'a piece' : `${pieces} pieces`}.`);
  return ok();
}

// ---------------------------------------------------------------- locking

/** Pins pieces to the table, or unpins them. Anyone may do it: this table has no admin role
 *  beyond the host, and a pinned board is one keypress from being free again. Locking lets go of
 *  the piece, so the pin takes effect now rather than when the current drag ends. */
export function setLock(ctx: TableContext, playerId: string, ids: string[], locked: unknown): OpResult {
  if (typeof locked !== 'boolean') return fail();
  let n = 0;
  let blocked: PieceState | undefined;
  for (const id of ids) {
    const piece = ctx.state.pieces.get(id);
    if (!piece || piece.locked === locked) continue;
    if (lockedByOther(piece, playerId)) { blocked = piece; continue; }
    piece.locked = locked;
    if (locked) piece.lockedBy = '';
    n++;
  }
  if (!n) return fail(blocked ? lockNotice(ctx, blocked) : undefined);
  appendLog(ctx, `${nameOf(ctx, playerId)} ${locked ? 'locked' : 'unlocked'} ${n === 1 ? 'a piece' : `${n} pieces`}.`);
  return ok();
}

// ---------------------------------------------------------------- loading a kit

const KIND_ORDER: Record<PieceKind, number> = { board: 0, card: 1, piece: 2 };

/** Spawns every piece in the kit onto the table: boards centered (stacked slightly offset if more
 * than one), cards/pieces scattered in a loose grid nearby so nothing lands exactly on top of a board. */
export function loadKit(ctx: TableContext, playerId: string, kit: NormalizedKit, definitions: PieceDefinition[]): OpResult {
  const byId = new Map(definitions.map(d => [d.id, d]));
  const queue: PieceDefinition[] = [];
  for (const { pieceId, quantity } of kit.pieces) {
    const def = byId.get(pieceId);
    if (!def) continue;
    for (let i = 0; i < quantity; i++) queue.push(def);
  }
  if (!queue.length) return fail('That kit has nothing usable in it.');
  queue.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  let boardI = 0, gridI = 0;
  const cols = Math.max(1, Math.ceil(Math.sqrt(queue.length)));
  for (const def of queue) {
    const face: PieceFace = { pieceId: def.id, kind: def.kind, name: def.name, frontImage: def.frontImage, w: def.w, h: def.h };
    if (def.backImage) face.backImage = def.backImage;
    if (def.model) face.model = def.model;
    if (def.metadata) face.metadata = def.metadata;
    let x: number, z: number;
    if (def.kind === 'board') { x = boardI * 0.6; z = boardI * 0.6; boardI++; }
    else {
      const col = gridI % cols, row = Math.floor(gridI / cols);
      const step = Math.max(def.w, def.h) + 0.3;
      x = (col - (cols - 1) / 2) * step;
      z = (row - Math.ceil(queue.length / cols) / 2) * step + 14;
      gridI++;
    }
    createPiece(ctx, { ownerId: playerId, face, x, z, faceUp: true });
  }
  appendLog(ctx, `${nameOf(ctx, playerId)} loaded “${kit.name}” (${queue.length} pieces).`);
  return ok();
}

// ---------------------------------------------------------------- markers & notes

export const MARKER_KINDS = ['plus', 'minus', 'damage', 'status', 'custom', 'die', 'diePips', 'd4', 'd8', 'd10', 'd12', 'd20'] as const;
const DIE_KIND_SET = new Set<MarkerKind>(DIE_KINDS);
const MARKER_DEFAULTS: Record<(typeof MARKER_KINDS)[number], { label: string; value: number }> = {
  plus: { label: '+', value: 1 },
  minus: { label: '−', value: 1 },
  damage: { label: 'DMG', value: 1 },
  status: { label: 'STATUS', value: 0 },
  custom: { label: 'MARK', value: 0 },
  die: { label: 'DIE', value: 1 },
  diePips: { label: 'DIE', value: 1 },
  d4: { label: 'D4', value: 1 },
  d8: { label: 'D8', value: 1 },
  d10: { label: 'D10', value: 1 },
  d12: { label: 'D12', value: 1 },
  d20: { label: 'D20', value: 1 },
};
export const LIMITS = { markers: 300, notes: 150 };

export function spawnMarker(ctx: TableContext, playerId: string, msg: { kind?: unknown; label?: unknown; x?: unknown; z?: unknown }): OpResult {
  const kind = MARKER_KINDS.find(k => k === msg.kind);
  if (!kind) return fail();
  if (ctx.state.markers.size >= LIMITS.markers) return fail('That is a lot of markers — delete some first.');
  const m = new MarkerState();
  m.id = `m${ctx.nextId++}`;
  m.kind = kind;
  m.label = cleanText(msg.label, 16) || MARKER_DEFAULTS[kind].label;
  m.value = DIE_KIND_SET.has(kind) ? 1 + ctx.randomInt(DIE_SIDES[kind] ?? 6) : MARKER_DEFAULTS[kind].value;
  const pos = isFiniteNumber(msg.x) && isFiniteNumber(msg.z) ? clampToTable(msg.x, msg.z) : { x: 0, z: 0 };
  m.x = pos.x;
  m.z = pos.z;
  m.lockedBy = '';
  m.attachedTo = '';
  m.order = ctx.nextOrder++;
  ctx.state.markers.set(m.id, m);
  return ok();
}
export function adjustMarker(ctx: TableContext, playerId: string, id: unknown, delta: unknown): OpResult {
  const m = typeof id === 'string' ? ctx.state.markers.get(id) : undefined;
  if (!m || !isFiniteNumber(delta)) return fail();
  if (lockedByOther(m, playerId)) return fail(lockNotice(ctx, m, 'marker'));
  m.value = Math.max(-99, Math.min(999, m.value + Math.round(delta)));
  return ok();
}
export function rollMarker(ctx: TableContext, playerId: string, id: unknown): OpResult {
  const m = typeof id === 'string' ? ctx.state.markers.get(id) : undefined;
  if (!m || !DIE_KIND_SET.has(m.kind as MarkerKind)) return fail();
  if (lockedByOther(m, playerId)) return fail(lockNotice(ctx, m, 'die'));
  m.value = 1 + ctx.randomInt(DIE_SIDES[m.kind as MarkerKind] ?? 6);
  m.rolls = (m.rolls + 1) % 65535;
  const die = m.kind === 'die' || m.kind === 'diePips' ? 'd6' : m.kind;
  appendLog(ctx, `${nameOf(ctx, playerId)} rolled ${m.value} on a ${die}.`);
  return ok();
}
export function renameMarker(ctx: TableContext, playerId: string, id: unknown, label: unknown): OpResult {
  const m = typeof id === 'string' ? ctx.state.markers.get(id) : undefined;
  const text = cleanText(label, 16);
  if (!m || !text) return fail();
  m.label = text;
  return ok();
}
export function addNote(ctx: TableContext, playerId: string, msg: { text?: unknown; x?: unknown; z?: unknown }): OpResult {
  const text = cleanText(msg.text, 280);
  if (!text) return fail();
  if (ctx.state.notes.size >= LIMITS.notes) return fail('The table is full of notes — delete some first.');
  const n = new NoteState();
  n.id = `n${ctx.nextId++}`;
  n.text = text;
  n.author = nameOf(ctx, playerId);
  const pos = isFiniteNumber(msg.x) && isFiniteNumber(msg.z) ? clampToTable(msg.x, msg.z) : { x: 0, z: 0 };
  n.x = pos.x;
  n.z = pos.z;
  n.lockedBy = '';
  n.order = ctx.nextOrder++;
  ctx.state.notes.set(n.id, n);
  appendLog(ctx, `${n.author} left a note: “${text.length > 60 ? `${text.slice(0, 57)}…` : text}”`);
  return ok();
}
export function editNote(ctx: TableContext, playerId: string, id: unknown, text: unknown): OpResult {
  const n = typeof id === 'string' ? ctx.state.notes.get(id) : undefined;
  const clean = cleanText(text, 280);
  if (!n || !clean) return fail();
  if (lockedByOther(n, playerId)) return fail(lockNotice(ctx, n, 'note'));
  n.text = clean;
  n.author = nameOf(ctx, playerId);
  appendLog(ctx, `${n.author} edited a note.`);
  return ok();
}

// ---------------------------------------------------------------- table look

const HEX = /^#[0-9a-f]{6}$/i;

/** Anyone can restyle the table: it's cosmetic, shared and logged. Image existence is the room's job. */
export function setTableLook(ctx: TableContext, actorId: string, raw: { felt?: unknown; image?: unknown; backdrop?: unknown; atmosphere?: unknown }): OpResult {
  const s = ctx.state, who = nameOf(ctx, actorId);
  let line = '';
  if (raw.atmosphere && typeof raw.atmosphere === 'object') {
    const a = raw.atmosphere as { kind?: unknown; strength?: unknown };
    const kind = ATMOSPHERE_KINDS.find(k => k === a.kind);
    if (!kind || typeof a.strength !== 'number' || !Number.isFinite(a.strength)) return fail();
    const json = JSON.stringify({ kind, strength: Math.round(Math.min(1, Math.max(0.1, a.strength)) * 100) / 100 });
    if (json !== s.lookAtmosphere) {
      const was = s.lookAtmosphere ? (JSON.parse(s.lookAtmosphere) as { kind: string }).kind : 'none';
      s.lookAtmosphere = json;
      // Dragging the strength slider shouldn't flood the log — only a change of weather is logged.
      if (was !== kind) line = kind === 'none' ? `${who} cleared the weather.` : `${who} set the weather to ${kind}.`;
      else return ok();
    }
  }
  if (raw.backdrop && typeof raw.backdrop === 'object') {
    const b = raw.backdrop as { mode?: unknown; colors?: unknown; image?: unknown; effect?: unknown };
    const mode = BACKDROP_MODES.find(m => m === b.mode);
    const colors = Array.isArray(b.colors) ? b.colors.filter((c): c is string => typeof c === 'string' && HEX.test(c)).slice(0, 3).map(c => c.toLowerCase()) : [];
    const image = b.image ? cleanImageUrl(b.image) : '';
    const effect = BACKDROP_EFFECTS.find(e => e === b.effect) ?? 'none';
    if (!mode || !colors.length) return fail();
    if (mode === 'image' && !image) return fail('That image is not on this server.');
    const json = JSON.stringify({ mode, colors, image, effect });
    if (json !== s.lookBackdrop) { s.lookBackdrop = json; line = `${who} changed the background.`; }
  }
  if (typeof raw.felt === 'string' && HEX.test(raw.felt) && raw.felt.toLowerCase() !== s.lookFelt.toLowerCase()) {
    s.lookFelt = raw.felt.toLowerCase();
    line = `${who} changed the table color.`;
  }
  if (typeof raw.image === 'string' && raw.image !== s.lookImage) {
    const image = raw.image === '' ? '' : cleanImageUrl(raw.image);
    if (raw.image !== '' && !image) return fail('That image is not on this server.');
    s.lookImage = image;
    line = image ? `${who} put a custom image on the table.` : `${who} removed the table image.`;
  }
  if (!line) return fail();
  if (s.log.at(-1) !== line) appendLog(ctx, line);
  return ok();
}

// ---------------------------------------------------------------- table-wide

/** Host: clears every piece, marker and note off the table (a fresh start for the same players). */
export function clearTable(ctx: TableContext, actorId: string): OpResult {
  if (!isStaff(ctx, actorId)) return fail('Only the host or a co-host can clear the table.');
  ctx.state.pieces.clear();
  ctx.state.markers.clear();
  ctx.state.notes.clear();
  ctx.state.players.forEach(p => p.counters.forEach((_v, k) => p.counters.set(k, 0)));
  appendLog(ctx, `${nameOf(ctx, actorId)} cleared the table.`);
  return ok();
}

// ---------------------------------------------------------------- point counters
const COUNTER_NAME_MAX = 10, COUNTER_LIMIT = 9999;
const cleanCounterName = (v: unknown) => (typeof v === 'string' ? v.replace(/[^\p{L}\p{N} _-]/gu, '').trim().toUpperCase().slice(0, COUNTER_NAME_MAX) : '');

/** Change one player's counter by delta, or set it to value. Anyone can change anyone's — like TTS. */
export function setCounter(ctx: TableContext, actorId: string, msg: { playerId?: unknown; key?: unknown; delta?: unknown; value?: unknown }): OpResult {
  const p = typeof msg.playerId === 'string' ? ctx.state.players.get(msg.playerId) : undefined;
  const key = typeof msg.key === 'string' ? msg.key : '';
  if (!p || p.spectator || !ctx.state.counterNames.includes(key)) return fail();
  const before = p.counters.get(key) ?? 0;
  const raw = typeof msg.value === 'number' ? msg.value : before + (typeof msg.delta === 'number' ? msg.delta : 0);
  if (!Number.isFinite(raw)) return fail();
  const after = Math.max(-COUNTER_LIMIT, Math.min(COUNTER_LIMIT, Math.round(raw)));
  if (after === before) return ok();
  p.counters.set(key, after);
  // Tapping + five times is one change in the log, not five: the same player nudging the same
  // counter again replaces their last line.
  const prefix = `${nameOf(ctx, actorId)} changed ${p.name}'s ${key} `;
  const line = `${prefix}to ${after}.`;
  const log = ctx.state.log;
  if (log.length && log[log.length - 1].startsWith(prefix)) log[log.length - 1] = line;
  else appendLog(ctx, line);
  return ok();
}

export function addCounter(ctx: TableContext, actorId: string, name: unknown): OpResult {
  const key = cleanCounterName(name);
  if (!key) return fail('Counter names use letters and numbers.');
  if (ctx.state.counterNames.includes(key)) return fail(`There's already a ${key} counter.`);
  if (ctx.state.counterNames.length >= MAX_COUNTERS) return fail(`Up to ${MAX_COUNTERS} counters.`);
  ctx.state.counterNames.push(key);
  ctx.state.players.forEach(p => p.counters.set(key, 0));
  appendLog(ctx, `${nameOf(ctx, actorId)} added the ${key} counter.`);
  return ok();
}

export function removeCounter(ctx: TableContext, actorId: string, name: unknown): OpResult {
  const i = typeof name === 'string' ? ctx.state.counterNames.indexOf(name) : -1;
  if (i < 0) return fail();
  ctx.state.counterNames.splice(i, 1);
  ctx.state.players.forEach(p => p.counters.delete(name as string));
  appendLog(ctx, `${nameOf(ctx, actorId)} removed the ${name} counter.`);
  return ok();
}

export function renameCounter(ctx: TableContext, actorId: string, from: unknown, to: unknown): OpResult {
  const i = typeof from === 'string' ? ctx.state.counterNames.indexOf(from) : -1;
  const key = cleanCounterName(to);
  if (i < 0 || !key) return fail('Counter names use letters and numbers.');
  if (key === from) return ok();
  if (ctx.state.counterNames.includes(key)) return fail(`There's already a ${key} counter.`);
  ctx.state.counterNames[i] = key;
  ctx.state.players.forEach(p => { p.counters.set(key, p.counters.get(from as string) ?? 0); p.counters.delete(from as string); });
  appendLog(ctx, `${nameOf(ctx, actorId)} renamed ${from} to ${key}.`);
  return ok();
}

// ---------------------------------------------------------------- table & piece info

/** Turns the table grid on (inches) or off (0). Placement only — nothing here is a rule. */
export function setGrid(ctx: TableContext, actorId: string, size: unknown): OpResult {
  const next = typeof size === 'number' && Number.isFinite(size)
    ? Math.round(Math.max(0, Math.min(12, size)) * 2) / 2 : 0;
  if (ctx.state.gridSize === next) return ok();
  ctx.state.gridSize = next;
  appendLog(ctx, next ? `${nameOf(ctx, actorId)} set the grid to ${next}".` : `${nameOf(ctx, actorId)} turned the grid off.`);
  return ok();
}

/** Renames pieces and/or sets their description. Both live in the piece's face and are display
 *  only — the table never reads them as anything but text. */
export function setPieceInfo(ctx: TableContext, playerId: string, ids: string[], name: unknown, description: unknown): OpResult {
  const newName = name === undefined ? undefined : cleanText(name, 60);
  const newDescription = description === undefined ? undefined : cleanText(description, 280);
  if (newName === undefined && newDescription === undefined) return fail();
  if (newName === '') return fail('A piece needs a name.');
  let changed = 0;
  let blocked: PieceState | undefined;
  let pinned = false;
  for (const id of ids) {
    const piece = ctx.state.pieces.get(id);
    if (!piece) continue;
    if (piece.locked) { pinned = true; continue; }
    if (lockedByOther(piece, playerId)) { blocked = piece; continue; }
    const face = faceOf(piece);
    if (!face) continue;
    const next: PieceFace = { ...face };
    if (newName !== undefined) next.name = newName;
    if (newDescription !== undefined) {
      if (newDescription) next.description = newDescription;
      else delete next.description;
    }
    piece.face = JSON.stringify(next);
    changed++;
  }
  if (!changed) return fail(blocked ? lockNotice(ctx, blocked) : pinned ? LOCKED_NOTICE : undefined);
  const what = changed === 1 ? 'a piece' : `${changed} pieces`;
  if (newName !== undefined) appendLog(ctx, `${nameOf(ctx, playerId)} renamed ${what} to "${newName}".`);
  else appendLog(ctx, `${nameOf(ctx, playerId)} described ${what}.`);
  return ok();
}

// ---------------------------------------------------------------- saving & loading a table

/** A save file is just another untrusted input: a table can be big, but not unbounded. */
const SAVE_LIMITS = { pieces: 1200, bytes: 4 * 1024 * 1024 };

const toInt = (v: unknown, fallback = 0) => (isFiniteNumber(v) ? Math.round(v) : fallback);
const clampedInt = (v: unknown, lo: number, hi: number, fallback = lo) => Math.min(hi, Math.max(lo, toInt(v, fallback)));
const hexColor = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);

/** Turns a `.sagatable.json` into a snapshot we are willing to put on the table. Every field is
 *  re-validated the way a live message would be — a save can come from another table, an older
 *  build, or a text editor. Bad entries are dropped rather than failing the whole file, but a
 *  file where *nothing* survives is refused so a broken save can't quietly empty the table.
 *  Accepts both the wrapped file and a bare snapshot (the shape the history stack stores). */
export function sanitizeSnapshot(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const wrapper = raw as Record<string, unknown>;
  const body = (wrapper.table ?? wrapper) as Record<string, unknown>;
  if (!Array.isArray(body.pieces) || !Array.isArray(body.markers) || !Array.isArray(body.notes)) return null;
  if (body.pieces.length > SAVE_LIMITS.pieces || body.markers.length > LIMITS.markers || body.notes.length > LIMITS.notes) return null;

  const used = new Set<string>();
  const takeId = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!/^[\w.-]{1,40}$/.test(s) || used.has(s)) return '';
    used.add(s);
    return s;
  };

  const pieces: TableSnapshot['pieces'] = [];
  for (const entry of body.pieces) {
    if (typeof entry !== 'object' || entry === null) continue;
    const r = entry as Record<string, unknown>;
    const id = takeId(r.id);
    if (!id) continue;
    let face: PieceFace | null = null;
    try { face = sanitizeFace(typeof r.face === 'string' ? JSON.parse(r.face) : r.face); } catch { face = null; }
    if (!face) continue;
    const w = Math.min(60, Math.max(0.1, isFiniteNumber(r.w) ? r.w : face.w));
    const h = Math.min(60, Math.max(0.1, isFiniteNumber(r.h) ? r.h : face.h));
    const pos = clampToTable(isFiniteNumber(r.x) ? r.x : 0, isFiniteNumber(r.z) ? r.z : 0, w, h);
    pieces.push({
      id,
      ownerId: typeof r.ownerId === 'string' ? r.ownerId.slice(0, 64) : '',
      x: pos.x, z: pos.z, w, h,
      rotation: ((toInt(r.rotation) % 360) + 360) % 360,
      faceUp: r.faceUp !== false,
      tapped: r.tapped === true,
      order: clampedInt(r.order, 0, 0xffffffff, pieces.length),
      lockedBy: '',
      locked: r.locked === true,
      face: JSON.stringify(face),
      backImage: cleanImageUrl(r.backImage),
      kind: face.kind,
      orient: clampedInt(r.orient, 0, 5, 0),
    });
  }

  const markers: TableSnapshot['markers'] = [];
  for (const entry of body.markers) {
    if (typeof entry !== 'object' || entry === null) continue;
    const r = entry as Record<string, unknown>;
    const id = takeId(r.id);
    if (!id) continue;
    const kind = MARKER_KINDS.find(k => k === r.kind);
    if (!kind) continue;
    const pos = clampToTable(isFiniteNumber(r.x) ? r.x : 0, isFiniteNumber(r.z) ? r.z : 0);
    const attachedTo = typeof r.attachedTo === 'string' && used.has(r.attachedTo) ? r.attachedTo : '';
    markers.push({
      id, kind, label: cleanText(r.label, 16), value: clampedInt(r.value, -99, 999, 1),
      x: pos.x, z: pos.z, lockedBy: '', attachedTo,
      ox: attachedTo && isFiniteNumber(r.ox) ? r.ox : 0,
      oz: attachedTo && isFiniteNumber(r.oz) ? r.oz : 0,
      order: clampedInt(r.order, 0, 0xffffffff, markers.length),
      rolls: clampedInt(r.rolls, 0, 65535, 0),
    });
  }

  const notes: TableSnapshot['notes'] = [];
  for (const entry of body.notes) {
    if (typeof entry !== 'object' || entry === null) continue;
    const r = entry as Record<string, unknown>;
    const id = takeId(r.id);
    const text = cleanText(r.text, 280);
    if (!id || !text) continue;
    const pos = clampToTable(isFiniteNumber(r.x) ? r.x : 0, isFiniteNumber(r.z) ? r.z : 0);
    notes.push({ id, text, author: cleanText(r.author, 24), x: pos.x, z: pos.z, lockedBy: '', order: clampedInt(r.order, 0, 0xffffffff, notes.length) });
  }

  const submitted = body.pieces.length + body.markers.length + body.notes.length;
  if (!pieces.length && !markers.length && !notes.length && submitted > 0) return null;

  const counterNames: string[] = [];
  for (const name of Array.isArray(body.counterNames) ? body.counterNames : []) {
    const key = cleanCounterName(name);
    if (key && !counterNames.includes(key) && counterNames.length < MAX_COUNTERS) counterNames.push(key);
  }

  const counters: Record<string, Record<string, number>> = {};
  const rawCounters = (body.counters ?? {}) as Record<string, unknown>;
  for (const [playerId, row] of Object.entries(rawCounters)) {
    if (!/^[\w-]{1,64}$/.test(playerId) || typeof row !== 'object' || row === null) continue;
    const values: Record<string, number> = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      if (counterNames.includes(key) && isFiniteNumber(value)) values[key] = Math.max(-COUNTER_LIMIT, Math.min(COUNTER_LIMIT, Math.round(value)));
    }
    counters[playerId] = values;
  }

  const rawLook = (body.look ?? {}) as Record<string, unknown>;
  const snapshot: TableSnapshot = {
    v: 1,
    pieces, markers, notes, counterNames, counters,
    look: {
      felt: hexColor(rawLook.felt, DEFAULT_FELT),
      image: cleanImageUrl(rawLook.image),
      // The client parses these defensively (parseBackdrop / parseAtmosphere fall back to the
      // default for anything odd), so they only need a length cap here.
      backdrop: typeof rawLook.backdrop === 'string' ? rawLook.backdrop.slice(0, 2000) : '',
      atmosphere: typeof rawLook.atmosphere === 'string' ? rawLook.atmosphere.slice(0, 200) : '',
    },
    gridSize: typeof body.gridSize === 'number' && Number.isFinite(body.gridSize)
      ? Math.round(Math.max(0, Math.min(12, body.gridSize)) * 2) / 2 : 0,
  };
  return JSON.stringify(snapshot);
}

/** This table as a self-describing save file the tester keeps on their own disk. */
export function saveTable(ctx: TableContext): { json: string; filename: string } {
  const json = JSON.stringify({
    format: 'saga-table',
    version: 1,
    roomCode: ctx.state.roomCode,
    savedAt: new Date().toISOString(),
    table: JSON.parse(snapshotOf(ctx.state)) as unknown,
  });
  return { json, filename: `${ctx.state.roomCode || 'SAGA'}.sagatable.json` };
}

/** Replaces the table with a saved one. Undoable, so a wrong file is one Ctrl+Z away. */
export function loadTable(ctx: TableContext, playerId: string, json: unknown): OpResult {
  if (typeof json !== 'string' || json.length > SAVE_LIMITS.bytes) return fail('That save file is too big to load.');
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return fail('That file is not valid JSON.'); }
  const snapshot = sanitizeSnapshot(parsed);
  if (!snapshot) return fail('That does not look like a SAGA table save.');
  if (!restoreSnapshot(ctx.state, snapshot)) return fail('That save could not be restored.');
  // Ids and draw order came from another table, so make sure the next thing we create can't
  // collide with something we just loaded.
  let maxId = 0, maxOrder = 0;
  for (const item of [...ctx.state.pieces.values(), ...ctx.state.markers.values(), ...ctx.state.notes.values()]) {
    maxId = Math.max(maxId, Number(item.id.replace(/^\D+/, '')) || 0);
    maxOrder = Math.max(maxOrder, item.order);
  }
  ctx.nextId = Math.max(ctx.nextId, maxId + 1);
  ctx.nextOrder = Math.max(ctx.nextOrder, maxOrder + 1);
  appendLog(ctx, `${nameOf(ctx, playerId)} loaded a saved table.`);
  return ok();
}
