// "A table from 4:12pm was saved — bring it back?" Shown to whoever opens a fresh table while a
// recent autosave is still on disk (a crash, a redeploy, or a closed laptop ended the last one).
import { store, useTable } from '../net/tableStore.ts';

function when(iso: string): string {
  const at = new Date(iso);
  if (!iso || Number.isNaN(at.getTime())) return 'earlier';
  return at.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function Resumable() {
  const t = useTable();
  const save = t.resumable;
  if (!save) return null;
  const parts = [
    save.pieces ? plural(save.pieces, 'piece') : '',
    save.markers ? plural(save.markers, 'marker') : '',
    save.notes ? plural(save.notes, 'note') : '',
  ].filter(Boolean).join(', ');
  return (
    <div className="resume-banner" role="status">
      <span>
        Saved table {save.roomCode || 'from earlier'} — {when(save.savedAt)}{parts ? `, ${parts}` : ''}.
      </span>
      <button className="btn small" onClick={() => { store.send('restoreAutosave', {}); store.showResume(null); }}>Restore</button>
      <button className="btn small ghost" onClick={() => store.showResume(null)}>No thanks</button>
    </div>
  );
}
