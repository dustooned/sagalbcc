// Big still images are shrunk before upload, so every player at the table downloads a fraction of
// the file. On by default; the student is asked first and can keep the original, as long as it
// still fits the upload limit. GIFs and clips are never touched (re-encoding would lose frames).
import { MAX_UPLOAD_BYTES } from '../net/api.ts';

/** How large an image needs to be on screen: a piece is a few inches, the table and backdrop
 *  fill the view. */
export const IMAGE_TARGET_PX = { piece: 2048, table: 4096 } as const;
/** Under both of these an image is uploaded as it is, without asking. */
const SMALL_BYTES = 1.5 * 1024 * 1024;

const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
const still = (file: File) => /^image\/(png|jpeg|webp)$/.test(file.type);

/** The file to upload (shrunk, or the original if the student says no), or null when the
 *  original is too big to keep. `tooBig` explains why in the usual problem/fix dialog. */
export async function prepareImage(
  file: File,
  target: number,
  tooBig: (message: string, fix: string) => void,
): Promise<File | null> {
  if (!still(file)) return file;
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { return file; } // the normal checks explain it
  try {
    const side = Math.max(bmp.width, bmp.height);
    if (side <= target && file.size <= SMALL_BYTES) return file;

    const k = Math.min(1, target / side);
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const smaller = await encode(bmp, w, h);
    // Re-encoding a small, already-compressed image can make it bigger: then keep the original.
    if (!smaller || smaller.size >= file.size) return file;

    const ok = confirm(
      `This image is ${mb(file.size)} (${bmp.width} × ${bmp.height}).\n\n`
      + `OK = shrink it to ${mb(smaller.size)} (${w} × ${h}) so it loads fast for everyone. Recommended.\n`
      + 'Cancel = keep the original.',
    );
    if (ok) return new File([smaller], file.name.replace(/\.[^.]+$/, '') + (smaller.type === 'image/jpeg' ? '.jpg' : smaller.type === 'image/webp' ? '.webp' : '.png'), { type: smaller.type });
    if (file.size > MAX_UPLOAD_BYTES) {
      tooBig(`This image is ${mb(file.size)} — the limit is ${mb(MAX_UPLOAD_BYTES)}.`, 'Add it again and choose OK to shrink it, or make it smaller in any image editor first.');
      return null;
    }
    return file;
  } finally { bmp.close(); }
}

/** Opaque → JPEG (small). See-through → WebP where the browser can write it, else PNG. */
async function encode(bmp: ImageBitmap, w: number, h: number): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = (type: string, q?: number) => new Promise<Blob | null>(r => c.toBlob(r, type, q));
  if (!seeThrough(ctx, w, h)) return blob('image/jpeg', 0.85);
  const webp = await blob('image/webp', 0.85);
  return webp?.type === 'image/webp' ? webp : blob('image/png');
}

function seeThrough(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const px = ctx.getImageData(0, 0, w, h).data;
  // Every 7th pixel is plenty to spot a cut-out or a transparent background.
  for (let i = 3; i < px.length; i += 28) if (px[i] < 250) return true;
  return false;
}
