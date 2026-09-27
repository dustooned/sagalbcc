// A problem that needs explaining, not just a toast — e.g. why a 3D model was rejected and the
// exact Blender steps to fix it. Stays until closed.
import { useTable } from '../net/tableStore.ts';

export function HelpDialog() {
  const t = useTable();
  if (!t.help) return null;
  return (
    <div className="help-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) t.showHelp(null); }}>
      <section className="hud-panel help-dialog" role="alertdialog" aria-labelledby="help-error">
        <h2 id="help-error">{t.help.error}</h2>
        <p>{t.help.fix}</p>
        <button className="btn primary" autoFocus onClick={() => t.showHelp(null)}>Got it</button>
      </section>
    </div>
  );
}
