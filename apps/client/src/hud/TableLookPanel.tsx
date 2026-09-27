// Quick table look: felt color swatches + your own image on the table. Shared with everyone
// at the table (it's cosmetic, and the change shows up in the log).
import { useRef, useState } from 'react';
import { BACKDROP_PRESETS, DEFAULT_BACKDROP, FELT_PRESETS, parseBackdrop, type Backdrop, type BackdropEffect } from '@kitforge/shared-types';
import { uploadImage } from '../net/api.ts';
import { useTable } from '../net/tableStore.ts';

export function TableLookPanel() {
  const t = useTable();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const bgInput = useRef<HTMLInputElement>(null);
  const [grad, setGrad] = useState(['#2b1055', '#d53369', '#ffb86b']);
  const pending = useRef<{ color: string; timer: number } | null>(null);
  const state = t.state;

  // The native color picker fires on every drag tick; send the latest color at most ~6×/s.
  function sendFelt(color: string) {
    if (pending.current) { pending.current.color = color; return; }
    pending.current = { color, timer: window.setTimeout(() => { if (pending.current) t.send('setTableLook', { felt: pending.current.color }); pending.current = null; }, 150) };
  }
  if (!state) return null;
  const felt = state.lookFelt.toLowerCase();
  const bg = parseBackdrop(state.lookBackdrop);
  const sendBg = (next: Partial<Backdrop>) => t.send('setTableLook', { backdrop: { ...bg, ...next } });
  const same = (a: string[], b: string[]) => a.join() === b.join();
  const preview = (c: string[]) => `linear-gradient(180deg, ${c.join(', ')})`;

  async function useBgImage(file: File) {
    if (!file.type.startsWith('image/')) { t.notify('Pick a PNG, JPG or WebP image.'); return; }
    setBusy(true);
    try {
      const { assetUrl } = await uploadImage(file);
      sendBg({ mode: 'image', image: assetUrl });
    } catch (err) { t.notify((err as Error).message); } finally { setBusy(false); }
  }

  async function useImage(file: File) {
    if (!file.type.startsWith('image/')) { t.notify('Pick a PNG, JPG or WebP image.'); return; }
    setBusy(true);
    try {
      const { assetUrl } = await uploadImage(file);
      t.send('setTableLook', { image: assetUrl });
    } catch (err) { t.notify((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className={`hud-panel look-panel ${open ? 'open' : ''}`}>
      <button className="tools-head" onClick={() => setOpen(o => !o)}>🎨<span className="head-label"> TABLE LOOK</span> <span>{open ? '▾' : '▸'}</span></button>
      {open && (
        <div className="tools-body">
          <div className="swatches" role="radiogroup" aria-label="Table color">
            {FELT_PRESETS.map(p => (
              <button
                key={p.color}
                role="radio"
                aria-checked={felt === p.color}
                className={`swatch ${felt === p.color ? 'on' : ''}`}
                style={{ background: p.color }}
                title={p.name}
                onClick={() => t.send('setTableLook', { felt: p.color })}
              />
            ))}
            <label className="swatch custom" title="Any color">
              <input type="color" value={felt} onChange={e => sendFelt(e.target.value)} />
            </label>
          </div>
          <div className="row wrap">
            <button className="btn small" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? 'Uploading…' : '🖼 Table image…'}</button>
            {state.lookImage && <button className="btn small ghost" onClick={() => t.send('setTableLook', { image: '' })}>Remove image</button>}
          </div>
          <p className="muted small">A map, a board, a battlefield — any image covers the table. A 15 × 11 shape (e.g. 3000 × 2200 px) fits without cropping.</p>
          <div className="field"><span>BACKGROUND</span></div>
          {(['Space', 'Nebula', 'Gradient'] as const).map(group => (
            <div key={group} className="bg-group">
              <span className="muted small">{group}</span>
              <div className="bg-presets">
                {BACKDROP_PRESETS.filter(p => p.group === group).map(p => (
                  <button key={p.name} title={p.name} aria-label={p.name}
                    className={`bg-preset ${bg.mode === p.look.mode && same(bg.colors, p.look.colors) ? 'on' : ''}`}
                    style={{ background: preview(p.look.colors) }}
                    onClick={() => sendBg({ ...p.look, image: '' })} />
                ))}
              </div>
            </div>
          ))}
          <div className="bg-group">
            <span className="muted small">Custom gradient</span>
            <div className="row">
              {grad.map((c, i) => (
                <input key={i} type="color" className="bg-color" value={c} aria-label={`Gradient color ${i + 1}`}
                  onChange={e => setGrad(g => g.map((x, j) => (j === i ? e.target.value : x)))} />
              ))}
              <button className="btn small" onClick={() => sendBg({ mode: 'gradient', colors: grad, image: '' })}>Use</button>
            </div>
          </div>
          <div className="row wrap">
            <button className="btn small" disabled={busy} onClick={() => bgInput.current?.click()}>🌌 Background image…</button>
            <button className="btn small ghost" onClick={() => t.send('setTableLook', { backdrop: DEFAULT_BACKDROP })}>Plain</button>
          </div>
          <div className="field"><span>EFFECT</span></div>
          <div className="seg" role="radiogroup" aria-label="Background effect">
            {([['none', 'Off'], ['wave', '〰 Wave'], ['kaleido', '❋ Kaleidoscope']] as [BackdropEffect, string][]).map(([e, label]) => (
              <button key={e} role="radio" aria-checked={bg.effect === e} className={bg.effect === e ? 'on' : ''}
                disabled={bg.mode === 'solid'} onClick={() => sendBg({ effect: e })}>{label}</button>
            ))}
          </div>
          <input ref={bgInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void useBgImage(f); }} />
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void useImage(f); }} />
        </div>
      )}
    </section>
  );
}
