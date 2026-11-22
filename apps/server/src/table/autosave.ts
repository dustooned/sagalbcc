// Autosaves on disk: the table survives a crash, a redeploy or a closed laptop.
//
// The file is byte-for-byte the same `.sagatable.json` a tester downloads with "Save table", so
// restoring one goes through exactly the same validated path as restoring a picked file. One
// table = one file; the newest one in the folder is what a fresh table offers to bring back.
import fs from 'node:fs';
import path from 'node:path';

export interface SaveFile {
  path: string;
  /** File mtime — used for "newest", so a hand-copied file counts by when it landed. */
  savedAtMs: number;
}

/** What a room tells the first player who joins: enough to describe, not the whole table. */
export interface SaveSummary {
  roomCode: string;
  savedAt: string;
  pieces: number;
  markers: number;
  notes: number;
}

const safeName = (code: string) => code.replace(/[^\w-]/g, '') || 'SAGA';

export const savePathFor = (dir: string, roomCode: string) => path.join(dir, `${safeName(roomCode)}.json`);

/** Writes via a temp file then renames, so a crash mid-write can never leave a half file that
 *  the next boot would offer to restore. Returns null on any IO problem (autosave must not throw
 *  into the game loop). */
export function writeSave(dir: string, roomCode: string, json: string): SaveFile | null {
  const final = savePathFor(dir, roomCode);
  const temp = `${final}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(temp, json, 'utf8');
    fs.renameSync(temp, final);
    return { path: final, savedAtMs: fs.statSync(final).mtimeMs };
  } catch (err) {
    console.error('[autosave] could not write', final, err);
    try { fs.rmSync(temp, { force: true }); } catch { /* nothing else to do */ }
    return null;
  }
}

/** The most recently written save in the folder, or null. */
export function newestSave(dir: string): SaveFile | null {
  try {
    let best: SaveFile | null = null;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const file = path.join(dir, entry.name);
      try {
        const mtime = fs.statSync(file).mtimeMs;
        if (!best || mtime > best.savedAtMs) best = { path: file, savedAtMs: mtime };
      } catch { /* raced with a delete */ }
    }
    return best;
  } catch { return null; }
}

export function readSave(file: SaveFile): string | null {
  try {
    return fs.readFileSync(file.path, 'utf8');
  } catch (err) {
    console.error('[autosave] could not read', file.path, err);
    return null;
  }
}

/** Drops saves older than `maxAgeMs`, and any temp files left by an interrupted write. */
export function pruneSaves(dir: string, maxAgeMs: number, now = Date.now()): number {
  let removed = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(dir, entry.name);
      const stale = entry.name.endsWith('.tmp') || (entry.name.endsWith('.json') && now - fs.statSync(file).mtimeMs > maxAgeMs);
      if (!stale) continue;
      try { fs.rmSync(file); removed++; } catch { /* another process got there first */ }
    }
  } catch { /* no saves folder yet */ }
  return removed;
}

/** Reads the bits a room needs to say "there is a table from 4:12pm with 23 pieces". */
export function summarise(json: string): SaveSummary | null {
  try {
    const file = JSON.parse(json) as { format?: string; roomCode?: string; savedAt?: string; table?: { pieces?: unknown[]; markers?: unknown[]; notes?: unknown[] } };
    if (file?.format !== 'saga-table' || !file.table) return null;
    const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
    return {
      roomCode: typeof file.roomCode === 'string' ? file.roomCode : '',
      savedAt: typeof file.savedAt === 'string' ? file.savedAt : '',
      pieces: count(file.table.pieces),
      markers: count(file.table.markers),
      notes: count(file.table.notes),
    };
  } catch { return null; }
}
