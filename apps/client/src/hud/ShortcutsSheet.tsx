// "?" opens every shortcut at once, grouped — the full list the right-click menus only hint at.
import { HOTKEYS } from './hotkeys.ts';
import { ui, useUi } from '../table/selection.ts';

export function ShortcutsSheet() {
  const u = useUi();
  if (!u.keysOpen) return null;
  const close = () => ui.setKeysOpen(false);
  return (
    <div className="help-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) close(); }}>
      <section className="hud-panel keys-sheet" role="dialog" aria-label="Keyboard shortcuts">
        <header><h2>Keyboard shortcuts</h2><button className="btn small ghost" autoFocus onClick={close} aria-label="Close">✕</button></header>
        <div className="keys-groups">
          {HOTKEYS.map(g => (
            <table key={g.group}>
              <caption>{g.group}</caption>
              <tbody>
                {g.keys.map(([keys, what]) => (
                  <tr key={what}>
                    <td>{keys.map((k, i) => (k === '/' ? <span key={i} className="muted"> / </span> : <kbd key={i}>{k}</kbd>))}</td>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
        <p className="muted small">Keys act on the selected pieces, or the piece under the pointer.</p>
      </section>
    </div>
  );
}
