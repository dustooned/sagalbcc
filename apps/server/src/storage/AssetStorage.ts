// Uploaded piece images live behind this interface so local disk can later be swapped for
// S3 / Cloudflare R2 / Supabase Storage without touching the room or HTTP code.

export type ImageType = 'png' | 'jpg' | 'webp' | 'gif';
/** Short looping clips for animated pieces. */
export type VideoType = 'webm' | 'mp4';
/** Everything storable: images, plus 3D models as single-file glTF binaries. */
export type AssetType = ImageType | VideoType | 'glb';

export interface AssetMetadata {
  type: AssetType;
  originalName?: string;
}

export interface StoredAsset {
  /** Opaque, unguessable file id, e.g. "Xb3k...Q.png". */
  id: string;
  type: AssetType;
  size: number;
  data?: Buffer;
}

export interface AssetStorage {
  save(file: Buffer, metadata: AssetMetadata): Promise<StoredAsset>;
  get(id: string): Promise<StoredAsset | null>;
  delete?(id: string): Promise<void>;
}

export const MIME: Record<AssetType, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', webm: 'video/webm', mp4: 'video/mp4', glb: 'model/gltf-binary' };

/** A glTF binary starts with the ASCII magic "glTF". */
export const isGlb = (buf: Buffer) => buf.length >= 12 && buf.toString('latin1', 0, 4) === 'glTF';

/** Identify an image by its actual bytes, never by the name or Content-Type the client claims. */
export function sniffImageType(buf: Buffer): ImageType | null {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return 'gif';
  return null;
}

/** WebM (an EBML file whose DocType is "webm") or MP4 (an ISO BMFF "ftyp" box). */
export function sniffVideoType(buf: Buffer): VideoType | null {
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0x1a45dfa3 && buf.subarray(0, 64).includes('webm')) return 'webm';
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  return null;
}

export const ASSET_ID = /^[A-Za-z0-9_-]{22}\.(png|jpg|webp|gif|webm|mp4|glb)$/;
