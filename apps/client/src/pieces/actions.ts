// Piece actions shared by keyboard shortcuts, the context menu and toolbars.
import type { MarkerKind, NormalizedKit, PieceDefinition, StackAction } from '@kitforge/shared-types';
import { store } from '../net/tableStore.ts';

export const actions = {
  flip: (ids: string[]) => ids.length && store.send('flip', { ids }),
  /** Left = counter-clockwise as seen from your seat. */
  rotateLeft: (ids: string[]) => ids.length && store.send('rotate', { ids, delta: 90 }),
  rotateRight: (ids: string[]) => ids.length && store.send('rotate', { ids, delta: -90 }),
  /** 15° steps — for 3D models and anything that shouldn't snap to quarter turns. */
  turnLeft: (ids: string[]) => ids.length && store.send('rotate', { ids, delta: 15 }),
  turnRight: (ids: string[]) => ids.length && store.send('rotate', { ids, delta: -15 }),
  bigger: (ids: string[]) => ids.length && store.send('resize', { ids, factor: 1.2 }),
  smaller: (ids: string[]) => ids.length && store.send('resize', { ids, factor: 1 / 1.2 }),
  /** 3D models: next "which way is up" (fixes models that import upside down or on their side). */
  orient: (ids: string[], dir: 1 | -1 = 1) => ids.length && store.send('orient', { ids, dir }),
  tap: (ids: string[]) => ids.length && store.send('tap', { ids }),
  turnAround: (ids: string[]) => ids.length && store.send('rotate', { ids, delta: 180 }),
  /** 3D models: stand on a given side (0 upright, 1 upside down, 2 on its front, 4 on its side). */
  standOn: (ids: string[], side: number) => ids.length && store.send('orient', { ids, set: side }),
  setFace: (ids: string[], faceUp: boolean) => ids.length && store.send('setFace', { ids, faceUp }),
  /** One piece: shuffle the stack it's in. Several: shuffle them together into one stack on the
   *  first one's spot (put the piece the player pointed at first). */
  shuffle: (ids: string[]) => {
    if (ids.length === 1) store.send('stackAction', { id: ids[0], action: 'shuffle' });
    else if (ids.length > 1) store.send('gather', { ids, shuffle: true });
  },
  gather: (ids: string[]) => ids.length > 1 && store.send('gather', { ids }),
  clone: (id: string) => store.send('clone', { id }),
  /** Clone several at once (capped so a held key can't flood the table). */
  cloneAll: (ids: string[]) => { for (const id of ids.slice(0, 20)) store.send('clone', { id }); },
  /** Shift+F: everything face down — or, if it already is, everything face up. */
  faceAll: (ids: string[]) => {
    if (!ids.length) return;
    const anyUp = ids.some(id => store.piece(id)?.faceUp);
    store.send('setFace', { ids, faceUp: !anyUp });
  },
  remove: (ids: string[]) => ids.length && store.send('remove', { ids }),
  /** Pin pieces so nobody can move them (or free them again). */
  setLock: (ids: string[], locked: boolean) => ids.length && store.send('setLock', { ids, locked }),
  /** K: pin the selection — or, if any of it is already free, pin rather than unpin. */
  toggleLock: (ids: string[]) => {
    if (!ids.length) return;
    store.send('setLock', { ids, locked: ids.some(id => !store.piece(id)?.locked) });
  },
  undo: () => store.send('undo', {}),
  redo: () => store.send('redo', {}),
  /** Table grid, in inches; 0 turns it off. */
  setGrid: (size: number) => store.send('setGrid', { size }),
  /** Rename a piece and/or set its description. Leave an argument out to keep that field. */
  setPieceInfo: (ids: string[], name?: string, description?: string) => {
    if (!ids.length) return;
    store.send('setPieceInfo', { ids, ...(name === undefined ? {} : { name }), ...(description === undefined ? {} : { description }) });
  },
  loadKit: (kit: NormalizedKit, definitions: PieceDefinition[]) => store.send('loadKit', { kit, definitions }),
  stack: (id: string, action: StackAction) => store.send('stackAction', { id, action }),
  spawnMarker: (kind: MarkerKind, label?: string) => store.send('spawnMarker', { kind, label }),
  adjustMarker: (id: string, delta: number) => store.send('adjustMarker', { id, delta }),
  rollMarker: (id: string) => store.send('rollMarker', { id }),
  counter: (playerId: string, key: string, delta: number) => store.send('counter', { playerId, key, delta }),
  setCounter: (playerId: string, key: string, value: number) => store.send('counter', { playerId, key, value }),
  addCounter: (name: string) => store.send('addCounter', { name }),
  renameCounter: (from: string, to: string) => store.send('renameCounter', { from, to }),
  removeCounter: (name: string) => store.send('removeCounter', { name }),
  addNote: (text: string) => store.send('addNote', { text }),
};
