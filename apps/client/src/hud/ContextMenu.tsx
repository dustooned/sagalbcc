// Right-click menu for pieces, markers and notes.
import { DIE_KINDS } from '@kitforge/shared-types';
import { actions } from '../pieces/actions.ts';
import { stackMembers } from '../pieces/stacks.ts';
import { store, useTable } from '../net/tableStore.ts';
import { editNotePrompt } from '../table/Note3D.tsx';
import { ui, useUi, type MenuState } from '../table/selection.ts';

/** Right-click on empty table: no piece to act on directly, so this is mostly a hotkey cheat
 *  sheet — but the buttons still work, acting on whatever's selected or last hovered. */
function BackgroundMenu({ menu }: { menu: MenuState }) {
  const run = (fn: () => void) => () => { fn(); ui.openMenu(null); };
  const ids = ui.ordered(ui.targets(id => !!store.piece(id)));
  const has = ids.length > 0;
  const many = ids.length > 1 ? ` (${ids.length})` : '';
  const left = Math.min(menu.x, window.innerWidth - 240), top = Math.max(8, Math.min(menu.y, window.innerHeight - 400));
  return (
    <>
      <div className="menu-catcher" onPointerDown={() => ui.openMenu(null)} onContextMenu={e => { e.preventDefault(); ui.openMenu(null); }} />
      <menu className="context-menu" style={{ left, top }}>
        <li className="menu-head">{has ? 'Selected piece' : 'Hotkeys'}{many}</li>
        <li><button disabled={!has} onClick={run(() => actions.flip(ids))}>Flip <kbd>F</kbd></button></li>
        <li><button disabled={!has} onClick={run(() => actions.rotateLeft(ids))}>Rotate left <kbd>Q</kbd></button></li>
        <li><button disabled={!has} onClick={run(() => actions.rotateRight(ids))}>Rotate right <kbd>E</kbd></button></li>
        <li><button disabled={!has} onClick={run(() => actions.tap(ids))}>Tap / Untap <kbd>T</kbd></button></li>
        <li><button disabled={!has} onClick={run(() => actions.shuffle(ids))}>Shuffle <kbd>R</kbd></button></li>
        <li><button disabled={ids.length < 2} onClick={run(() => actions.gather(ids))}>Gather into a stack <kbd>G</kbd></button></li>
        <li><button disabled={!has} onClick={() => actions.turnRight(ids)}>Turn 15° <kbd>Shift+Q/E</kbd></button></li>
        <li><button disabled={!has} onClick={() => actions.bigger(ids)}>Bigger <kbd>+</kbd></button></li>
        <li><button disabled={!has} onClick={() => actions.smaller(ids)}>Smaller <kbd>−</kbd></button></li>
        <li><button disabled={!has} className="danger" onClick={run(() => { actions.remove(ids); ui.select([]); })}>Delete <kbd>Del</kbd></button></li>
        <li className="sep" />
        <li><button onClick={run(() => ui.setKeysOpen(true))}>All shortcuts <kbd>?</kbd></button></li>
        <li className="menu-head"><kbd>Shift</kbd>/<kbd>Ctrl</kbd>+drag box-selects · <kbd>Ctrl+A</kbd> all · <kbd>Esc</kbd> none</li>
      </menu>
    </>
  );
}

function TokenMenu({ menu }: { menu: MenuState }) {
  const run = (fn: () => void) => () => { fn(); ui.openMenu(null); };
  const marker = menu.source === 'marker' ? store.state?.markers.get(menu.id) : undefined;
  if (menu.source === 'marker' && !marker) return null;
  const rename = () => { const label = prompt('Marker label:', marker?.label ?? ''); if (label?.trim()) store.send('renameMarker', { id: menu.id, label }); };
  const left = Math.min(menu.x, window.innerWidth - 220), top = Math.max(8, Math.min(menu.y, window.innerHeight - 240));
  return (
    <>
      <div className="menu-catcher" onPointerDown={() => ui.openMenu(null)} onContextMenu={e => { e.preventDefault(); ui.openMenu(null); }} />
      <menu className="context-menu" style={{ left, top }}>
        {marker && DIE_KINDS.includes(marker.kind) ? <>
          <li className="menu-head">Die</li>
          <li><button onClick={run(() => actions.rollMarker(menu.id))}>🎲 Roll</button></li>
        </> : marker ? <>
          <li className="menu-head">Marker</li>
          <li><button onClick={run(() => actions.adjustMarker(menu.id, 1))}>＋1</button></li>
          <li><button onClick={run(() => actions.adjustMarker(menu.id, -1))}>−1</button></li>
          <li><button onClick={run(() => actions.adjustMarker(menu.id, 5))}>＋5</button></li>
          <li><button onClick={run(rename)}>Rename…</button></li>
        </> : <>
          <li className="menu-head">Note</li>
          <li><button onClick={run(() => editNotePrompt(menu.id))}>Edit…</button></li>
        </>}
        <li className="sep" />
        <li><button className="danger" onClick={run(() => actions.remove([menu.id]))}>Delete</button></li>
      </menu>
    </>
  );
}

export function ContextMenu() {
  const t = useTable();
  const u = useUi();
  const menu = u.menu;
  if (!menu || !t.state) return null;
  if (menu.source === 'background') return <BackgroundMenu menu={menu} />;
  if (menu.source === 'marker' || menu.source === 'note') return <TokenMenu menu={menu} />;
  const piece = t.piece(menu.id);
  if (!piece) return null;
  // The piece that was right-clicked goes first: a gather or shuffle stacks onto its spot.
  const ids = u.selected.has(menu.id) ? [menu.id, ...[...u.selected].filter(i => i !== menu.id)] : [menu.id];
  const many = ids.length > 1 ? ` (${ids.length})` : '';
  const run = (fn: () => void) => () => { fn(); ui.openMenu(null); };
  const stack = stackMembers(t.state, piece);
  const isModel = (() => { try { return !!(JSON.parse(piece.face) as { model?: string }).model; } catch { return false; } })();
  const height = 420 + (stack.length > 1 ? 140 : 0) + (ids.length > 1 ? 130 : 0) + (isModel ? 40 : 0);
  const left = Math.min(menu.x, window.innerWidth - 220), topPx = Math.max(8, Math.min(menu.y, window.innerHeight - height));

  return (
    <>
      <div className="menu-catcher" onPointerDown={() => ui.openMenu(null)} onContextMenu={e => { e.preventDefault(); ui.openMenu(null); }} />
      <menu className="context-menu" style={{ left, top: topPx }}>
        {stack.length > 1 && <>
          <li className="menu-head">Stack · {stack.length}</li>
          <li><button onClick={run(() => actions.stack(menu.id, 'shuffle'))}>Shuffle stack {ids.length === 1 && <kbd>R</kbd>}</button></li>
          <li><button onClick={run(() => actions.stack(menu.id, 'flip'))}>Flip whole stack</button></li>
          <li><button onClick={run(() => actions.stack(menu.id, 'spread'))}>Spread out</button></li>
          <li><button onClick={run(() => ui.select(stack.map(c => c.id)))}>Select whole stack (then drag)</button></li>
          <li className="sep" />
        </>}
        {ids.length > 1 && <>
          <li className="menu-head">Selection · {ids.length}</li>
          <li><button onClick={run(() => actions.shuffle(ids))}>Shuffle into a stack <kbd>R</kbd></button></li>
          <li><button onClick={run(() => actions.gather(ids))}>Gather into a stack <kbd>G</kbd></button></li>
          <li className="menu-row">
            <button onClick={run(() => actions.setFace(ids, true))} title="Shift+F">▲ Face up</button>
            <button onClick={run(() => actions.setFace(ids, false))} title="Shift+F">▼ Face down</button>
          </li>
          <li className="sep" />
        </>}
        <li><button onClick={run(() => actions.flip(ids))}>Flip{many} <kbd>F</kbd></button></li>
        <li><button onClick={run(() => actions.rotateLeft(ids))}>Rotate left{many} <kbd>Q</kbd></button></li>
        <li><button onClick={run(() => actions.rotateRight(ids))}>Rotate right{many} <kbd>E</kbd></button></li>
        <li><button onClick={run(() => actions.tap(ids))}>{piece.tapped ? 'Untap' : 'Tap'}{many} <kbd>T</kbd></button></li>
        <li className="sep" />
        <li className="menu-row">
          <button onClick={() => actions.turnLeft(ids)} title="Shift+Q">↺ 15°</button>
          <button onClick={() => actions.turnRight(ids)} title="Shift+E">↻ 15°</button>
          <button onClick={() => actions.turnAround(ids)} title="A — turn it to face the other way">⟲ 180°</button>
        </li>
        {isModel && <>
          <li className="menu-head">Stand it…</li>
          <li className="menu-row">
            <button onClick={() => actions.standOn(ids, 0)} title="1 — as it was exported">⬆ Upright <kbd>1</kbd></button>
            <button onClick={() => actions.standOn(ids, 1)} title="2">⬇ Upside down <kbd>2</kbd></button>
          </li>
          <li className="menu-row">
            <button onClick={() => actions.standOn(ids, 4)} title="3">⤵ On side <kbd>3</kbd></button>
            <button onClick={() => actions.standOn(ids, 2)} title="4">⤴ On front <kbd>4</kbd></button>
          </li>
          <li><button onClick={() => actions.orient(ids)} title="Shift+U goes back">⤾ Next side <kbd>U</kbd></button></li>
        </>}
        <li className="menu-row">
          <button onClick={() => actions.smaller(ids)} title="− key">− Smaller</button>
          <button onClick={() => actions.bigger(ids)} title="+ key">＋ Bigger</button>
        </li>
        <li className="sep" />
        <li><button onClick={run(() => actions.cloneAll(ids))}>Clone{many} <kbd>C</kbd></button></li>
        <li><button className="danger" onClick={run(() => { actions.remove(ids); ui.select([]); })}>Delete{many} <kbd>Del</kbd></button></li>
      </menu>
    </>
  );
}
