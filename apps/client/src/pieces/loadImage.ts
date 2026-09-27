// Drop or upload a plain image straight onto the table — no Kit Forge kit or JSON needed. For a
// reference photo, a rules diagram, or anything a student doesn't want to build a full kit for.
// Reuses the same loadKit message as a real kit: a one-piece kit is still a kit.
import type { NormalizedKit, PieceDefinition } from '@kitforge/shared-types';
import { uploadImage } from '../net/api.ts';
import { store } from '../net/tableStore.ts';
import { actions } from './actions.ts';

/** A bare dropped image lands at a sensible size, not edge-to-edge on the table. */
const TARGET_SIDE_INCHES = 4;

function imageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ar = img.naturalWidth / img.naturalHeight;
      resolve(ar >= 1 ? { w: TARGET_SIDE_INCHES, h: TARGET_SIDE_INCHES / ar } : { w: TARGET_SIDE_INCHES * ar, h: TARGET_SIDE_INCHES });
    };
    img.onerror = () => reject(new Error('That image could not be read.'));
    img.src = url;
  });
}

export async function addImageFile(file: File) {
  if (!file.type.startsWith('image/')) { store.notify('Drop or pick a PNG, JPG or WebP image.'); return; }
  if (store.kitProgress) return;
  store.kitProgress = 'Adding image…';
  store.bump();
  try {
    const { assetUrl } = await uploadImage(file);
    const local = URL.createObjectURL(file);
    let size: { w: number; h: number };
    try { size = await imageSize(local); } finally { URL.revokeObjectURL(local); }
    const id = `img${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const name = file.name.replace(/\.[^.]+$/, '') || 'Image';
    const def: PieceDefinition = { id, kind: 'piece', name, frontImage: assetUrl, w: size.w, h: size.h };
    const kit: NormalizedKit = { name, pieces: [{ pieceId: id, quantity: 1 }] };
    actions.loadKit(kit, [def]);
    store.notify(`Added “${name}” to the table.`);
  } catch (err) {
    store.notify((err as Error).message);
  } finally {
    store.kitProgress = null;
    store.bump();
  }
}

/** Opens the browser's file picker for a plain image. */
export function pickImageFile() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
  input.onchange = () => { const f = input.files?.[0]; if (f) void addImageFile(f); };
  input.click();
}
