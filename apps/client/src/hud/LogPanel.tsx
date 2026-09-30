// Bottom left, above the camera: what's happened at the table — flips, shuffles, rolls, points,
// who joined. Folded, it still shows the latest line so nobody misses a roll.
import { useEffect, useRef, useState } from 'react';
import { useTable } from '../net/tableStore.ts';

export function LogPanel() {
  const t = useTable();
  const [open, setOpen] = useState(false);
  // L toggles it from the keyboard.
  useEffect(() => {
    const toggle = () => setOpen(o => !o);
    window.addEventListener('saga:toggle-log', toggle);
    return () => window.removeEventListener('saga:toggle-log', toggle);
  }, []);
  const list = useRef<HTMLOListElement>(null);
  const lines = t.state ? [...t.state.log] : [];
  const last = lines[lines.length - 1] ?? '';
  // Stay pinned to the newest line, unless the reader has scrolled up to look back.
  useEffect(() => {
    const el = list.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 60) el.scrollTop = el.scrollHeight;
  }, [lines.length, last, open]);
  if (!t.state) return null;

  return (
    <section className={`hud-panel log-panel ${open ? 'open' : ''}`} aria-label="Table log">
      <button className="tools-head" onClick={() => setOpen(o => !o)} aria-expanded={open} title="Log (L)">
        📜<span className="head-label"> LOG</span>
        {!open && last && <span className="log-last">{last}</span>}
        <span>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ol ref={list} className="log-lines" aria-live="polite">
          {lines.length ? lines.map((line, i) => <li key={i}>{line}</li>) : <li className="muted">Nothing yet — flips, shuffles, rolls and points show up here.</li>}
        </ol>
      )}
    </section>
  );
}
