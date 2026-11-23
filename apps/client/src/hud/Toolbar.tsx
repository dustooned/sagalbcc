// 🧰 Table tools: load a Kit Forge export, drop markers/notes, host-only clear. Collapsible so
// it never covers the table.
import { useState } from 'react';
import { BLENDER_EXPORT_HELP } from '@kitforge/shared-types';
import { actions } from '../pieces/actions.ts';
import { pickImageFile } from '../pieces/loadImage.ts';
import { pickModelFile } from '../pieces/loadModel.ts';
import { pickKitFile } from '../pieces/loadKit.ts';
import { pickTableFile, saveTable } from '../pieces/saveTable.ts';
import { useTable } from '../net/tableStore.ts';

export function Toolbar() {
  const t = useTable();
  // Starts collapsed on small screens so it doesn't cover the table.
  const [open, setOpen] = useState(() => window.innerWidth > 700);
  const staff = t.isStaff();
  // Spectators are read-only: the whole tool body is one disabled fieldset (links still work).
  const watching = t.isSpectator();
  const grid = t.state?.gridSize ?? 0;

  return (
    <section className={`hud-panel tools ${open ? 'open' : ''}`}>
      <button className="tools-head" onClick={() => setOpen(o => !o)}>🧰<span className="head-label"> TABLE TOOLS</span> <span>{open ? '▾' : '▸'}</span></button>
      {open && (
        <fieldset className="tools-body plain" disabled={watching} title={watching ? 'You are watching — spectators can’t change the table' : undefined}>
          {watching && <p className="muted small">👁 You are watching this table. You can point and ping (Alt+click), but not change anything.</p>}
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
          <div className="field"><span>SAVE</span></div>
          <div className="row wrap">
            <button className="btn small" onClick={saveTable} title="Download this table as a file you can keep">💾 Save table</button>
            <button className="btn small" disabled={!!t.kitProgress} onClick={pickTableFile} title="Put a saved table back. It replaces what's on the table, and Ctrl+Z undoes it.">📂 Load table…</button>
          </div>
          <div className="field"><span>GRID</span></div>
          <div className="row wrap">
            {[0, 1, 2, 4].map(size => (
              <button key={size} className={`btn small ${grid === size ? 'primary' : ''}`}
                title={size ? `Snap dropped pieces to a ${size}-inch grid` : 'No grid — pieces land where you drop them'}
                onClick={() => actions.setGrid(size)}>{size ? `${size}″` : 'Off'}</button>
            ))}
          </div>
          <div className="row wrap">
            <button className="btn small danger" disabled={!staff} title={staff ? '' : 'Host or co-host only'} onClick={() => { if (confirm('Clear every piece, marker and note off the table?')) t.send('resetTable', {}); }}>Clear table</button>
          </div>
        </fieldset>
      )}
    </section>
  );
}
