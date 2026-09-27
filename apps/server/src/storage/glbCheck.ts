// Server-side check of an uploaded glTF binary (.glb) before it's stored and shared with the
// table. The browser already pre-checks with a real 3D loader for instant feedback; this is the
// guarantee for anyone who skips it. Reads the file's own structure only — no 3D library.
import { MODEL_LIMITS, modelProblems, type ModelProblem } from '@kitforge/shared-types';

interface Gltf {
  buffers?: { uri?: string; byteLength?: number }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  accessors?: { count: number }[];
  meshes?: { primitives?: { attributes?: Record<string, number>; indices?: number; mode?: number }[] }[];
}

const JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;

/** Width of an embedded PNG or JPEG, read from its header; null if neither/unknown. */
function imageWidth(img: Buffer): number | null {
  if (img.length >= 24 && img.readUInt32BE(0) === 0x89504e47) return Math.max(img.readUInt32BE(16), img.readUInt32BE(20));
  if (img.length >= 4 && img[0] === 0xff && img[1] === 0xd8) {
    for (let i = 2; i + 9 < img.length;) {
      if (img[i] !== 0xff) { i++; continue; }
      const marker = img[i + 1];
      // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC): height at +5, width at +7.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return Math.max(img.readUInt16BE(i + 5), img.readUInt16BE(i + 7));
      }
      i += 2 + img.readUInt16BE(i + 2);
    }
  }
  return null;
}

export function checkGlb(buf: Buffer): ModelProblem | null {
  const mb = buf.length / 1024 / 1024;
  if (mb > MODEL_LIMITS.maxMB) return modelProblems.tooBig(mb);
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'glTF' || buf.readUInt32LE(4) !== 2) return modelProblems.unreadable();
  const total = buf.readUInt32LE(8);
  if (total > buf.length) return modelProblems.unreadable();

  let gltf: Gltf | null = null, bin: Buffer | null = null;
  for (let at = 12; at + 8 <= total;) {
    const len = buf.readUInt32LE(at), type = buf.readUInt32LE(at + 4);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (body.length !== len) return modelProblems.unreadable();
    if (type === JSON_CHUNK && !gltf) {
      try { gltf = JSON.parse(body.toString('utf8')) as Gltf; } catch { return modelProblems.unreadable(); }
    } else if (type === BIN_CHUNK && !bin) bin = body;
    at += 8 + len;
  }
  if (!gltf) return modelProblems.unreadable();

  // Everything must live inside this one file — no references to other files or URLs.
  const external = (uri?: string) => uri !== undefined && !uri.startsWith('data:');
  if ((gltf.buffers ?? []).some(b => external(b.uri)) || (gltf.images ?? []).some(i => external(i.uri))) return modelProblems.externalFiles();

  const accessors = gltf.accessors ?? [];
  let tris = 0, prims = 0;
  for (const mesh of gltf.meshes ?? []) {
    for (const p of mesh.primitives ?? []) {
      const mode = p.mode ?? 4;
      const count = p.indices !== undefined ? accessors[p.indices]?.count : p.attributes?.POSITION !== undefined ? accessors[p.attributes.POSITION]?.count : 0;
      if (!count) continue;
      prims++;
      if (mode === 4) tris += count / 3;
      else if (mode === 5 || mode === 6) tris += Math.max(0, count - 2);
    }
  }
  if (!prims) return modelProblems.empty();
  if (tris > MODEL_LIMITS.maxTriangles) return modelProblems.tooManyTriangles(Math.round(tris));

  for (const img of gltf.images ?? []) {
    const view = img.bufferView !== undefined ? gltf.bufferViews?.[img.bufferView] : undefined;
    if (!view || !bin) continue;
    const start = view.byteOffset ?? 0;
    const w = imageWidth(bin.subarray(start, start + view.byteLength));
    if (w && w > MODEL_LIMITS.maxTexturePx) return modelProblems.textureTooLarge(w);
  }
  return null;
}
