// 🧰 Table tools: load a Kit Forge export, drop markers/notes, host-only clear. Collapsible so
// it never covers the table.
import { useState } from 'react';
import { BLENDER_EXPORT_HELP } from '@kitforge/shared-types';
import { actions } from '../pieces/actions.ts';
import { pickImageFile } from '../pieces/loadImage.ts';
import { pickModelFile } from '../pieces/loadModel.ts';
import { pickKitFile } from '../pieces/loadKit.ts';
import { useTable } from '../net/tableStore.ts';

export function Toolbar() {
  const t = useTable();
  // Starts collapsed on small screens so it doesn't cover the table.
  const [open, setOpen] = useState(() => window.innerWidth > 700);
  const host = t.isHost();

  return (
    <section className={`hud-panel tools ${open ? 'open' : ''}`}>
      <button className="tools-head" onClick={() => setOpen(o => !o)}>🧰<span className="head-label"> TABLE TOOLS</span> <span>{open ? '▾' : '▸'}</span></button>
      {open && (
        <div className="tools-body">
          <div className="row wrap">
            <button className="btn small" disabled={!!t.kitProgress} onClick={pickKitFile}>{t.kitProgress ?? '📦 Load kit…'}</button>
            <button className="btn small" disabled={!!t.kitProgress} onClick={pickImageFile}>🖼️ Add image…</button>
            <button className="btn small" disabled={!!t.kitProgress} onClick={pickModelFile} title=".glb, .stl, or a textured .obj — pick the .obj, .mtl and images together, or a .zip">🧊 Add 3D model…</button>
            <button className="btn small ghost" onClick={() => t.showHelp(BLENDER_EXPORT_HELP)} title="Blender export settings" aria-label="Blender export settings">ⓘ</button>
            <a className="btn small ghost" href="https://dustooned.github.io/kitb/" target="_blank" rel="noreferrer">🛠️ Kit Forge</a>
            <a className="btn small ghost" href="/manual.html" target="_blank" rel="noreferrer">📖 Manual</a>
          </div>
          <div className="field"><span>MARKERS &amp; NOTES</span></div>
          <div className="row wrap">
            <button className="btn small" onClick={() => actions.spawnMarker('plus')}>+1</button>
            <button className="btn small" onClick={() => actions.spawnMarker('minus')}>−1</button>
            <button className="btn small" onClick={() => actions.spawnMarker('damage')}>DMG</button>
            <button className="btn small" onClick={() => actions.spawnMarker('status')}>STATUS</button>
            <button className="btn small" onClick={() => actions.spawnMarker('die')} title="Tap it to roll">🎲 D6</button>
            <button className="btn small" onClick={() => actions.spawnMarker('diePips')} title="Tap it to roll">⚅ D6 (dots)</button>
            <button className="btn small" onClick={() => actions.spawnMarker('d4')} title="Tap it to roll">🔺 D4</button>
            <button className="btn small" onClick={() => actions.spawnMarker('d8')} title="Tap it to roll">◆ D8</button>
            <button className="btn small" onClick={() => actions.spawnMarker('d10')} title="Tap it to roll">◈ D10</button>
            <button className="btn small" onClick={() => actions.spawnMarker('d12')} title="Tap it to roll">⬟ D12</button>
            <button className="btn small" onClick={() => actions.spawnMarker('d20')} title="Tap it to roll">🔷 D20</button>
            <button className="btn small" onClick={() => { const label = prompt('Marker label (e.g. FROZEN, SHIELD):'); if (label?.trim()) actions.spawnMarker('custom', label); }}>Custom…</button>
            <button className="btn small" onClick={() => { const text = prompt('Note for the table:'); if (text?.trim()) actions.addNote(text); }}>📝 Note…</button>
          </div>
          <div className="row wrap">
            <button className="btn small danger" disabled={!host} title={host ? '' : 'Host only'} onClick={() => { if (confirm('Clear every piece, marker and note off the table?')) t.send('resetTable', {}); }}>Clear table</button>
          </div>
        </div>
      )}
    </section>
  );
}
