// Center of an empty table: what to do first. Disappears once anything is on the table, or if
// dismissed — some tables are meant to stay empty (dice/markers only), and this shouldn't nag.
import { useState } from 'react';
import { pickImageFile } from '../pieces/loadImage.ts';
import { pickKitFile } from '../pieces/loadKit.ts';
import { pickModelFile } from '../pieces/loadModel.ts';
import { useTable } from '../net/tableStore.ts';

export function EmptyTable() {
  const t = useTable();
  const [dismissed, setDismissed] = useState(false);
  if (!t.state || t.state.pieces.size > 0 || dismissed) return null;
  return (
    <section className="hud-panel empty-table">
      <button className="icon-btn empty-table-close" title="Close" aria-label="Close" onClick={() => setDismissed(true)}>✕</button>
      <h2>Your table is empty</h2>
      <p className="muted small">In Kit Forge, hit <b>Send to Table</b>, then drop that <code>.kittable.json</code> anywhere on this page. A LOL, FIGHT TIEM! deck works too: drop its <code>.lftdeck.json</code> from Card Forge’s <b>Send to playtest</b>. Or drop a plain image, or:</p>
      <div className="row wrap" style={{ justifyContent: 'center' }}>
        <button className="btn primary" disabled={!!t.kitProgress} onClick={pickKitFile}>{t.kitProgress ?? '📦 Load kit…'}</button>
        <button className="btn" disabled={!!t.kitProgress} onClick={pickImageFile}>🖼️ Add image…</button>
        <button className="btn" disabled={!!t.kitProgress} onClick={pickModelFile}>🧊 Add 3D model…</button>
      </div>
    </section>
  );
}
