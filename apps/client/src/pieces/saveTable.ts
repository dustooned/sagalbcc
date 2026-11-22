// Saving the whole table to a file, and putting one back. The server builds and validates the
// JSON (it owns the authoritative state); the browser only carries the bytes both ways.
import { store } from '../net/tableStore.ts';
import { loadKitFile } from './loadKit.ts';

/** The save file's own marker, so a dropped .json can be routed without guessing. */
export const TABLE_SAVE_FORMAT = 'saga-table';

/** Ask the server for the file — the reply arrives as `tableSaved` and lands in `downloadSave`. */
export function saveTable() {
  store.send('saveTable', {});
}

/** Hands finished save bytes to the browser as a download. No server round trip. */
export function downloadSave(json: string, filename: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** A dropped or picked `.json`: a SAGA save replaces the table, anything else is a Kit Forge kit. */
export async function loadTableFile(file: File) {
  let text = '';
  try { text = await file.text(); } catch { store.notify('That file could not be read.'); return; }
  let format = '';
  try { format = (JSON.parse(text) as { format?: string } | null)?.format ?? ''; } catch {
    store.notify('That file is not valid JSON.');
    return;
  }
  if (format === TABLE_SAVE_FORMAT) {
    if (!confirm('Replace everything on the table with this save? (Ctrl+Z puts it back.)')) return;
    store.send('loadTable', { json: text });
    return;
  }
  await loadKitFile(file);
}

export function pickTableFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = () => { const file = input.files?.[0]; if (file) void loadTableFile(file); };
  input.click();
}
