// The table: 3D pieces fill the screen, small HUD panels sit in the corners.
import { useCallback, useEffect, useState } from 'react';
import { actions } from '../pieces/actions.ts';
import { addImageFile, isTableMedia } from '../pieces/loadImage.ts';
import { addModelFile } from '../pieces/loadModel.ts';
import { loadKitFile } from '../pieces/loadKit.ts';
import { showRoomInAddressBar } from '../net/invite.ts';
import { store, useTable } from '../net/tableStore.ts';
import { CameraPanel } from '../hud/CameraPanel.tsx';
import { ContextMenu } from '../hud/ContextMenu.tsx';
import { EmptyTable } from '../hud/EmptyTable.tsx';
import { HelpDialog } from '../hud/HelpDialog.tsx';
import { LogPanel } from '../hud/LogPanel.tsx';
import { ShortcutsSheet } from '../hud/ShortcutsSheet.tsx';
import { Notices } from '../hud/Notices.tsx';
import { RoomPanel } from '../hud/RoomPanel.tsx';
import { TableLookPanel } from '../hud/TableLookPanel.tsx';
import { Toolbar } from '../hud/Toolbar.tsx';
import { ui, useUi } from '../table/selection.ts';
import { Tabletop } from '../table/Tabletop.tsx';

/** Every table shortcut. hud/hotkeys.ts lists them for the ? sheet — keep the two in step. */
function useTableKeys(toggleHud: () => void) {
  useEffect(() => {
    const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement)?.closest?.('input, textarea, select');
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.altKey) return;
      // Ctrl/⌘+A: select every piece on the table.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && store.state) {
        e.preventDefault();
        ui.select([...store.state.pieces.values()].filter(p => !p.lockedBy || p.lockedBy === store.playerId).map(p => p.id));
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      if (e.code === 'Space') { ui.spaceHeld = true; e.preventDefault(); return; }
      const ids = ui.ordered(ui.targets(id => !!store.piece(id)));
      // 3D models: 1–4 pick a side directly (by key position, so Shift doesn't turn 1 into !).
      const side = { Digit1: 0, Digit2: 1, Digit3: 4, Digit4: 2 }[e.code];
      if (side !== undefined && !e.shiftKey) { actions.standOn(ids, side); return; }
      if (e.key === '?') { ui.setKeysOpen(!ui.keysOpen); return; }
      switch (e.key.toLowerCase()) {
        case 'f': if (e.shiftKey) actions.faceAll(ids); else actions.flip(ids); break;
        case 'a': actions.turnAround(ids); break;
        case 'c': actions.cloneAll(ids); break;
        case 'n': { const text = prompt('Note for the table:'); if (text?.trim()) actions.addNote(text); break; }
        case 'l': window.dispatchEvent(new Event('saga:toggle-log')); break;
        case 'h': toggleHud(); break;
        case 'q': if (e.shiftKey) actions.turnLeft(ids); else actions.rotateLeft(ids); break;
        case 'e': if (e.shiftKey) actions.turnRight(ids); else actions.rotateRight(ids); break;
        case '=': case '+': actions.bigger(ids); break;
        case '-': case '_': actions.smaller(ids); break;
        case 't': actions.tap(ids); break;
        case 'r': actions.shuffle(ids); break;
        case 'g': actions.gather(ids); break;
        case 'u': actions.orient(ids, e.shiftKey ? -1 : 1); break;
        case 'delete':
        case 'backspace':
          if (ids.length && (ids.length === 1 || confirm(`Delete ${ids.length} pieces?`))) { actions.remove(ids); ui.select([]); }
          break;
        case 'escape': if (ui.keysOpen) ui.setKeysOpen(false); else ui.clear(); break;
      }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') ui.spaceHeld = false; };
    const blur = () => { ui.spaceHeld = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [toggleHud]);
}

/** Drop a .kittable.json, or a plain image, anywhere on the page to load it. */
function useKitDrop() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const onOver = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); setOver(true); };
    const onLeave = (e: DragEvent) => { if (!e.relatedTarget) setOver(false); };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setOver(false);
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      if (/\.json$/i.test(file.name)) void loadKitFile(file);
      else if (isTableMedia(file)) void addImageFile(file);
      // .glb loads; other 3D formats go the same way so they get the Blender export steps.
      else if (/\.(glb|gltf|blend|fbx|obj|stl|dae|3ds|usdz?)$/i.test(file.name)) void addModelFile(file);
      else store.notify('Drop a .kittable.json from Kit Forge, a PNG/JPG/WebP/GIF image, a WebM/MP4 clip, or a .glb/.obj/.stl 3D model.');
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => { window.removeEventListener('dragover', onOver); window.removeEventListener('dragleave', onLeave); window.removeEventListener('drop', onDrop); };
  }, []);
  return over;
}

/** The rectangle drawn while box-selecting. */
function SelectBox() {
  const { box } = useUi();
  if (!box) return null;
  const style = { left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) };
  return <div className="select-box" style={style} />;
}

/** Touch screens: one finger turns the camera, so box-selecting needs its own mode. */
function SelectModeButton() {
  const u = useUi();
  const [touch] = useState(() => window.matchMedia('(pointer: coarse)').matches);
  if (!touch) return null;
  return (
    <button className={`box-toggle ${u.boxMode ? 'on' : ''}`} aria-pressed={u.boxMode}
      title={u.boxMode ? 'Select mode on: drag a box around pieces' : 'Select several pieces by drawing a box'}
      onClick={() => ui.setBoxMode(!u.boxMode)}>⬚</button>
  );
}

export function TableScreen() {
  const t = useTable();
  const [hudHidden, setHudHidden] = useState(false);
  const toggleHud = useCallback(() => setHudHidden(h => !h), []);
  useTableKeys(toggleHud);
  const dropping = useKitDrop();
  const roomCode = t.state?.roomCode ?? '';
  useEffect(() => { if (roomCode) showRoomInAddressBar(roomCode); }, [roomCode]);
  // A clear view of the table, one tap away — most useful on a small screen where the panels
  // cover real board space. Per-viewer only; each tab starts with the HUD shown.

  return (
    <main className="table-screen">
      <Tabletop />
      {!hudHidden && (
        <>
          <div className="hud tl"><RoomPanel /></div>
          <div className="hud tc"><Notices /></div>
          <div className="hud cc"><EmptyTable /></div>
          <div className="hud bl"><LogPanel /><CameraPanel /></div>
          <div className="hud br"><TableLookPanel /><Toolbar /></div>
        </>
      )}
      {/* Right-click menus work even with panels hidden — they're not part of the HUD to hide. */}
      <SelectBox />
      <SelectModeButton />
      <ContextMenu />
      <HelpDialog />
      <ShortcutsSheet />
      <button
        className="hud-toggle"
        title={hudHidden ? 'Show panels' : 'Hide panels'}
        aria-label={hudHidden ? 'Show panels' : 'Hide panels'}
        onClick={() => setHudHidden(h => !h)}
      >
        {hudHidden ? '☰' : '✕'}
      </button>
      {dropping && <div className="drop-overlay">Drop your kit or an image to add it to the table</div>}
    </main>
  );
}
