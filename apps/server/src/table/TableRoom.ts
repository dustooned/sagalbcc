// One private table. Owns authoritative table state; validates message structure, room
// membership and piece locks — never any particular game's rules.
import { randomBytes, randomInt } from 'node:crypto';
import { Room, ServerError, type Client, type Delayed } from '@colyseus/core';
import { MAX_PLAYERS, MAX_SPECTATORS } from '@kitforge/shared-types';
import { verifyToken } from '../auth.ts';
import { services } from '../services.ts';
import { ASSET_ID } from '../storage/AssetStorage.ts';
import { claimRoomCode, releaseRoomCode } from './roomCode.ts';
import { cleanIds, sanitizeDefinition, sanitizeKit, KIT_LIMITS } from './sanitize.ts';
import { newestSave, pruneSaves, readSave, summarise, writeSave, type SaveSummary } from './autosave.ts';
import type { TableState } from './TableState.ts';
import * as ops from './tableOps.ts';

/** Seconds a dropped connection keeps its session (refresh / Wi-Fi blip). */
export const RECONNECT_SECONDS = 120;

type Handler = (playerId: string, msg: any, client: Client) => ops.OpResult | void | Promise<ops.OpResult | void>;

/** The only messages a spectator may send. Everything else is refused in one place — the
 *  dispatcher in `on()` — rather than by permission checks scattered through the ops. */
const SPECTATOR_MESSAGES = new Set(['ping', 'point', 'pointerPing']);
const SPECTATOR_NOTICE = 'You are watching this table. Spectators can point and ping, but not change anything.';
/** A spectator dragging a piece fires many refused messages; one notice per this many ms is enough. */
const SPECTATOR_NOTICE_MS = 2000;

export class TableRoom extends Room<{ state: TableState }> {
  // Seats plus headroom for ghost sessions during reconnects, plus the spectator gallery.
  maxClients = MAX_PLAYERS * 2 + MAX_SPECTATORS;
  private spectatorNoticeAt = new Map<string, number>();
  ctx!: ops.TableContext;
  private sessions = new Map<string, string>(); // sessionId -> playerId
  private buckets = new Map<string, { tokens: number; at: number }>();
  private closeTimer: Delayed | undefined;
  private autosaveTimer: Delayed | undefined;
  /** A table saved by an earlier room that this one is willing to bring back. */
  private resume: { json: string; summary: SaveSummary } | null = null;

  onCreate() {
    // We close empty tables ourselves (after a grace period) instead of the instant the last
    // tester leaves: a closed laptop or a long Wi-Fi drop shouldn't wipe the table.
    this.autoDispose = false;
    this.ctx = ops.createTableContext();
    this.roomId = claimRoomCode(n => randomInt(n));
    this.ctx.state.roomCode = this.roomId;
    this.setState(this.ctx.state);
    void this.setPrivate(true);
    this.prepareAutosave();
    this.registerHandlers();
    this.checkEmpty();
  }

  onAuth(_client: Client, options: any) {
    if (!verifyToken(options?.token, services().config.sessionSecret)) throw new ServerError(401, 'Your session expired. Enter the password again.');
    return true;
  }

  onJoin(client: Client, options: any) {
    const res = ops.addPlayer(this.ctx, {
      name: options?.name, reclaimPlayerId: options?.reclaimPlayerId, spectate: options?.spectate === true,
      newId: `p_${randomBytes(6).toString('hex')}`,
    });
    if (!res.player) throw new ServerError(409, res.error ?? 'Could not join.');
    for (const [sid, pid] of this.sessions) if (pid === res.player.id) this.sessions.delete(sid);
    this.sessions.set(client.sessionId, res.player.id);
    client.send('welcome', { playerId: res.player.id, roomCode: this.roomId });
    // Only the player who opens a fresh table is offered the leftover autosave — after that the
    // table is in use and re-offering would be noise. A spectator couldn't restore it anyway.
    if (this.resume && this.ctx.state.players.size === 1 && !res.player.spectator) client.send('resumable', this.resume.summary);
    this.checkEmpty();
  }

  onDrop(client: Client) {
    const pid = this.sessions.get(client.sessionId);
    if (pid) ops.setConnected(this.ctx, pid, false);
    this.allowReconnection(client, RECONNECT_SECONDS).catch(() => {});
  }

  onReconnect(client: Client) {
    const pid = this.sessions.get(client.sessionId);
    // Kicked or banned while the connection was down: don't leave a seatless socket attached.
    if (!pid || !this.ctx.state.players.has(pid)) { client.leave(4000); return; }
    ops.setConnected(this.ctx, pid, true);
    client.send('welcome', { playerId: pid, roomCode: this.roomId });
    this.checkEmpty();
  }

  onLeave(client: Client) {
    const pid = this.sessions.get(client.sessionId);
    this.sessions.delete(client.sessionId);
    this.buckets.delete(client.sessionId);
    this.spectatorNoticeAt.delete(client.sessionId);
    if (!pid) return;
    ops.setConnected(this.ctx, pid, false);
    ops.dropSpectator(this.ctx, pid);
    ops.reassignHost(this.ctx);
    this.checkEmpty();
    // Last one out: write now, so the save is current even if the room sits empty for a while.
    if (![...this.ctx.state.players.values()].some(p => p.connected)) this.autosave();
  }

  onDispose() {
    this.autosave();
    this.autosaveTimer?.clear();
    releaseRoomCode(this.roomId);
  }

  /** Starts autosaving and looks for a recent table worth offering to bring back. */
  private prepareAutosave() {
    const config = services().config;
    if (config.autosaveMinutes <= 0) return;
    // A week is generous for "I forgot to save", and stops the folder growing without limit.
    pruneSaves(config.savesDir, 7 * 24 * 60 * 60_000);
    this.autosaveTimer = this.clock.setInterval(() => this.autosave(), config.autosaveMinutes * 60_000);
    const newest = newestSave(config.savesDir);
    if (!newest || Date.now() - newest.savedAtMs > config.recoverHours * 60 * 60_000) return;
    const json = readSave(newest);
    const summary = json ? summarise(json) : null;
    if (!json || !summary) return;
    if (!summary.pieces && !summary.markers && !summary.notes) return;
    this.resume = { json, summary };
  }

  /** Writes this table to disk. An empty table is never written, so opening a fresh room can't
   *  clobber the save that a tester would have wanted back. */
  private autosave() {
    const state = this.ctx?.state;
    if (!state) return;
    if (!state.pieces.size && !state.markers.size && !state.notes.size) return;
    writeSave(services().config.savesDir, this.roomId, ops.saveTable(this.ctx).json);
  }

  private checkEmpty() {
    const anyone = [...this.ctx.state.players.values()].some(p => p.connected);
    if (anyone) { this.closeTimer?.clear(); this.closeTimer = undefined; return; }
    if (this.closeTimer) return;
    this.closeTimer = this.clock.setTimeout(() => { void this.disconnect(); }, services().config.emptyTableMinutes * 60_000);
  }

  /** Token bucket per connection: plenty for dragging (~20 moves/s), stops floods. */
  private allow(sessionId: string) {
    const now = Date.now();
    const b = this.buckets.get(sessionId) ?? { tokens: 60, at: now };
    b.tokens = Math.min(60, b.tokens + ((now - b.at) / 1000) * 40);
    b.at = now;
    this.buckets.set(sessionId, b);
    if (b.tokens < 1) return false;
    b.tokens--;
    return true;
  }

  private on(type: string, handler: Handler) {
    this.onMessage(type, async (client: Client, msg: unknown) => {
      const pid = this.sessions.get(client.sessionId);
      const player = pid ? this.ctx.state.players.get(pid) : undefined;
      if (!pid || !player || !this.allow(client.sessionId)) return;
      // The one permission gate for spectators: read-only except presence and latency.
      if (player.spectator && !SPECTATOR_MESSAGES.has(type)) {
        const now = Date.now();
        if (now - (this.spectatorNoticeAt.get(client.sessionId) ?? 0) >= SPECTATOR_NOTICE_MS) {
          this.spectatorNoticeAt.set(client.sessionId, now);
          client.send('notice', { text: SPECTATOR_NOTICE });
        }
        return;
      }
      try {
        const res = await handler(pid, typeof msg === 'object' && msg !== null ? msg : {}, client);
        if (res?.notice) client.send('notice', { text: res.notice });
      } catch (err) {
        console.error(`[room ${this.roomId}] ${type} failed:`, err);
      }
    });
  }

  private registerHandlers() {
    const c = this.ctx;
    // Everything discrete gets exactly one undo step (`ops.undoable`). Dragging is the exception:
    // grab opens the step and the move/drop packets mutate inside it, so Ctrl+Z undoes the whole
    // move rather than the last 50 ms of it.
    this.on('grab', (pid, m) => ops.undoable(c, () => ops.grab(c, pid, m.id)));
    this.on('move', (pid, m) => { ops.move(c, pid, m.id, m.x, m.z); });
    this.on('drop', (pid, m) => ops.drop(c, pid, m.id, m.x, m.z, m.snap !== false));
    this.on('grabMany', (pid, m) => ops.undoable(c, () => ops.grabMany(c, pid, cleanIds(m.ids))));
    this.on('moveMany', (pid, m) => { ops.moveMany(c, pid, m.items); });
    this.on('dropMany', (pid, m) => { ops.dropMany(c, pid, m.items); });
    this.on('stackAction', (pid, m) => ops.undoable(c, () => ops.stackAction(c, pid, m.id, m.action)));
    this.on('flip', (pid, m) => ops.undoable(c, () => ops.flip(c, pid, cleanIds(m.ids))));
    this.on('rotate', (pid, m) => ops.undoable(c, () => ops.rotate(c, pid, cleanIds(m.ids), m.delta)));
    this.on('resize', (pid, m) => ops.undoable(c, () => ops.resize(c, pid, cleanIds(m.ids), m.factor)));
    this.on('orient', (pid, m) => ops.undoable(c, () => ops.orient(c, pid, cleanIds(m.ids), m.dir, m.set)));
    this.on('setFace', (pid, m) => ops.undoable(c, () => ops.setFace(c, pid, cleanIds(m.ids, 300), m.faceUp)));
    this.on('gather', (pid, m) => ops.undoable(c, () => ops.gather(c, pid, cleanIds(m.ids, 300), m.shuffle)));
    this.on('tap', (pid, m) => ops.undoable(c, () => ops.tap(c, pid, cleanIds(m.ids))));
    this.on('clone', (pid, m) => ops.undoable(c, () => ops.clone(c, pid, m.id)));
    this.on('remove', (pid, m) => ops.undoable(c, () => ops.remove(c, pid, cleanIds(m.ids))));
    this.on('setLock', (pid, m) => ops.undoable(c, () => ops.setLock(c, pid, cleanIds(m.ids), m.locked)));
    this.on('setGrid', (pid, m) => ops.undoable(c, () => ops.setGrid(c, pid, m.size)));
    this.on('setPieceInfo', (pid, m) => ops.undoable(c, () => ops.setPieceInfo(c, pid, cleanIds(m.ids), m.name, m.description)));
    // Undo and redo are never themselves undoable, or Ctrl+Z would just toggle between two states.
    this.on('undo', pid => ops.undo(c, pid));
    this.on('redo', pid => ops.redo(c, pid));
    // Saving only reads; the reply is the file itself, so it goes out on its own message.
    this.on('saveTable', (_pid, _m, client) => { client.send('tableSaved', ops.saveTable(c)); });
    this.on('loadTable', (pid, m) => ops.undoable(c, () => ops.loadTable(c, pid, m.json)));
    this.on('restoreAutosave', pid => {
      const resume = this.resume;
      if (!resume) return { ok: false, notice: 'There is no saved table to restore.' };
      const res = ops.undoable(c, () => ops.loadTable(c, pid, resume.json));
      if (res.ok) this.resume = null; // don't offer it to the next person who joins
      return res;
    });
    this.on('spawnMarker', (pid, m) => ops.undoable(c, () => ops.spawnMarker(c, pid, m)));
    this.on('adjustMarker', (pid, m) => ops.undoable(c, () => ops.adjustMarker(c, pid, m.id, m.delta)));
    this.on('rollMarker', (pid, m) => ops.undoable(c, () => ops.rollMarker(c, pid, m.id)));
    this.on('renameMarker', (pid, m) => ops.undoable(c, () => ops.renameMarker(c, pid, m.id, m.label)));
    this.on('counter', (pid, m) => ops.undoable(c, () => ops.setCounter(c, pid, m)));
    this.on('addCounter', (pid, m) => ops.undoable(c, () => ops.addCounter(c, pid, m.name)));
    this.on('renameCounter', (pid, m) => ops.undoable(c, () => ops.renameCounter(c, pid, m.from, m.to)));
    this.on('removeCounter', (pid, m) => ops.undoable(c, () => ops.removeCounter(c, pid, m.name)));
    this.on('addNote', (pid, m) => ops.undoable(c, () => ops.addNote(c, pid, m)));
    this.on('editNote', (pid, m) => ops.undoable(c, () => ops.editNote(c, pid, m.id, m.text)));
    this.on('resetTable', pid => ops.undoable(c, () => ops.clearTable(c, pid)));
    this.on('setTableLook', async (pid, m) => {
      const bgImage = m.backdrop && typeof m.backdrop === 'object' ? (m.backdrop as { image?: unknown }).image : undefined;
      if (typeof bgImage === 'string' && bgImage !== '') {
        const id = bgImage.startsWith('/uploads/') ? bgImage.slice(9) : '';
        if (!ASSET_ID.test(id) || !(await services().storage.get(id))) return { ok: false, notice: 'That image was not found on the server.' };
      }
      if (typeof m.image === 'string' && m.image !== '') {
        const id = m.image.startsWith('/uploads/') ? m.image.slice(9) : '';
        if (!ASSET_ID.test(id) || !(await services().storage.get(id))) return { ok: false, notice: 'That image was not found on the server.' };
      }
      return ops.undoable(c, () => ops.setTableLook(c, pid, m));
    });
    this.on('ping', (_pid, m, client) => { client.send('pong', { t: typeof m.t === 'number' ? m.t : 0 }); });
    // Presence: high-frequency, not table state — never undoable, never logged, no notices.
    this.on('point', (pid, m) => { ops.setPointer(c, pid, m.x, m.z); });
    this.on('pointerPing', (pid, m) => { ops.pingPointer(c, pid, m.x, m.z); });

    this.on('loadKit', (pid, m) => {
      const kit = sanitizeKit(m.kit);
      if (!kit) return { ok: false, notice: 'That kit could not be loaded (bad format or too many pieces).' };
      const defs = (Array.isArray(m.definitions) ? m.definitions.slice(0, KIT_LIMITS.definitions) : []).map(sanitizeDefinition).filter(Boolean);
      return ops.undoable(c, () => ops.loadKit(c, pid, kit, defs as NonNullable<ReturnType<typeof sanitizeDefinition>>[]));
    });

    // Permission changes (kick, ban, unban, promote) are session state, not table state: none of
    // them is wrapped in `undoable`, so no Ctrl+Z can bring a removed player back or undo a ban.
    this.on('kick', (pid, m) => {
      const res = ops.kick(c, pid, m.playerId);
      if (res.ok) this.evict(m.playerId, 'You were removed from this table.');
      return res;
    });
    this.on('ban', (pid, m) => {
      const res = ops.ban(c, pid, m.playerId);
      if (res.ok) this.evict(m.playerId, 'You were removed from this table and can’t rejoin under that name.');
      return res;
    });
    this.on('unban', (pid, m) => ops.unban(c, pid, m.name));
    this.on('promote', (pid, m) => ops.promote(c, pid, m.playerId, m.promoted));
  }

  /** Disconnects every session belonging to a player the ops just removed. */
  private evict(playerId: unknown, text: string) {
    for (const [sid, target] of this.sessions) {
      if (target !== playerId) continue;
      this.sessions.delete(sid);
      const gone = this.clients.getById(sid);
      gone?.send('kicked', { text });
      gone?.leave(4000);
    }
  }
}
