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
  tap: (ids: string[]) => ids.length && store.send('tap', { ids }),
  clone: (id: string) => store.send('clone', { id }),
  remove: (ids: string[]) => ids.length && store.send('remove', { ids }),
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
