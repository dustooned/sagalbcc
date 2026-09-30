// Drop or upload a plain image straight onto the table — no Kit Forge kit or JSON needed. For a
// reference photo, a rules diagram, or anything a student doesn't want to build a full kit for.
// Reuses the same loadKit message as a real kit: a one-piece kit is still a kit.
import { MEDIA_LIMITS, mediaProblems, type ModelProblem, type NormalizedKit, type PieceDefinition } from '@kitforge/shared-types';
import { parseGIF } from 'gifuct-js';
import { uploadImage, uploadMedia } from '../net/api.ts';
import { store } from '../net/tableStore.ts';
import { actions } from './actions.ts';
import { IMAGE_TARGET_PX, prepareImage } from './compressImage.ts';

/** A bare dropped image lands at a sensible size, not edge-to-edge on the table. */
const TARGET_SIDE_INCHES = 4;

const fit = (w: number, h: number) => {
  const ar = w / h || 1;
  return ar >= 1 ? { w: TARGET_SIDE_INCHES, h: TARGET_SIDE_INCHES / ar } : { w: TARGET_SIDE_INCHES * ar, h: TARGET_SIDE_INCHES };
};

/** What the browser learns about a file before uploading it: its size on the table, or the
 *  problem to explain (with the fix) instead of uploading. */
type Inspection = { size: { w: number; h: number } } | { problem: ModelProblem };

function inspectClip(url: string, mb: number): Promise<Inspection> {
  if (mb > MEDIA_LIMITS.videoMaxMB) return Promise.resolve({ problem: mediaProblems.clipTooBig(mb) });
  return new Promise(resolve => {
    const v = document.createElement('video');
    v.preload = 'metadata'; v.muted = true;
    v.onloadedmetadata = () => {
      const side = Math.max(v.videoWidth, v.videoHeight);
      if (!side) resolve({ problem: mediaProblems.clipUnplayable() });
      else if (v.duration > MEDIA_LIMITS.videoMaxSeconds + 0.05) resolve({ problem: mediaProblems.clipTooLong(v.duration) });
      else if (side > MEDIA_LIMITS.videoMaxPx) resolve({ problem: mediaProblems.clipTooLarge(side) });
      else resolve({ size: fit(v.videoWidth, v.videoHeight) });
    };
    v.onerror = () => resolve({ problem: mediaProblems.clipUnplayable() });
    v.src = url;
  });
}

async function inspectGif(file: File): Promise<Inspection> {
  const mb = file.size / 1024 / 1024;
  if (mb > MEDIA_LIMITS.gifMaxMB) return { problem: mediaProblems.gifTooBig(mb) };
  let gif;
  try { gif = parseGIF(await file.arrayBuffer()); } catch { return { problem: mediaProblems.gifUnreadable() }; }
  const { width, height } = gif.lsd;
  // Frame count and timing come straight from the GIF's own frame headers — no decoding needed.
  const frames = gif.frames.filter(f => 'image' in f);
  const seconds = gif.frames.reduce((t, f) => t + ('gce' in f ? Math.max(f.gce.delay || 0, 1) : 0), 0) / 100;
  if (!width || !height || !frames.length) return { problem: mediaProblems.gifUnreadable() };
  if (frames.length > MEDIA_LIMITS.gifMaxFrames) return { problem: mediaProblems.gifTooManyFrames(frames.length) };
  if (seconds > MEDIA_LIMITS.gifMaxSeconds) return { problem: mediaProblems.gifTooLong(seconds) };
  if (Math.max(width, height) > MEDIA_LIMITS.gifMaxPx) return { problem: mediaProblems.gifTooLarge(Math.max(width, height)) };
  return { size: fit(width, height) };
}

function inspectImage(url: string): Promise<Inspection> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ size: fit(img.naturalWidth, img.naturalHeight) });
    img.onerror = () => resolve({ problem: { error: 'That image could not be read.', fix: 'Re-save it as PNG or JPG and try again.' } });
    img.src = url;
  });
}

/** Still images, animated GIFs, and short WebM/MP4 loops (which play silently on the piece). */
export const isTableMedia = (file: File) => /^image\/(png|jpeg|webp|gif)$/.test(file.type) || /^video\/(webm|mp4)$/.test(file.type) || /\.(gif|webm|mp4)$/i.test(file.name);

export async function addImageFile(input: File) {
  if (!isTableMedia(input)) { store.showHelp(mediaProblems.wrongType(input.name)); return; }
  if (store.kitProgress) return;
  // Big photos are shrunk first (the student is asked); GIFs and clips pass straight through.
  const file = await prepareImage(input, IMAGE_TARGET_PX.piece, (error, fix) => store.showHelp({ error, fix }));
  if (!file) return;
  const video = file.type.startsWith('video/') || /\.(webm|mp4)$/i.test(file.name);
  const gif = file.type === 'image/gif' || /\.gif$/i.test(file.name);
  store.kitProgress = video ? 'Checking clip…' : 'Adding image…';
  store.bump();
  const local = URL.createObjectURL(file);
  try {
    const result = video ? await inspectClip(local, file.size / 1024 / 1024) : gif ? await inspectGif(file) : await inspectImage(local);
    if ('problem' in result) { store.showHelp(result.problem); return; }
    store.kitProgress = video ? 'Uploading clip…' : 'Adding image…';
    store.bump();
    const { assetUrl } = video ? await uploadMedia(file) : await uploadImage(file);
    const id = `img${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const name = file.name.replace(/\.[^.]+$/, '') || 'Image';
    const def: PieceDefinition = { id, kind: 'piece', name, frontImage: assetUrl, ...result.size };
    const kit: NormalizedKit = { name, pieces: [{ pieceId: id, quantity: 1 }] };
    actions.loadKit(kit, [def]);
    store.notify(`Added “${name}” to the table.`);
  } catch (err) {
    // The server re-checks size and dimensions; its answer carries the same fix text.
    const e = err as Error & { fix?: string };
    if (e.fix) store.showHelp({ error: e.message, fix: e.fix });
    else store.showHelp({ error: 'That file couldn’t be added.', fix: e.message });
  } finally {
    URL.revokeObjectURL(local);
    store.kitProgress = null;
    store.bump();
  }
}

/** Opens the browser's file picker for a plain image. */
export function pickImageFile() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,video/webm,video/mp4,.gif,.webm,.mp4' });
  input.onchange = () => { const f = input.files?.[0]; if (f) void addImageFile(f); };
  input.click();
}
