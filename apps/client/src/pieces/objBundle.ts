// A textured OBJ, the way it usually arrives from a download or another 3D app: the .obj, its
// .mtl material file and a folder of images — dropped together or as one .zip. Everything is
// matched up and baked into one .glb here, so the server and every other player only ever see
// one self-contained file.
//
// The .mtl is read by hand rather than with three's MTLLoader: exported .mtl files often name
// textures by absolute paths from the artist's own computer (C:\Users\…\wood.png), so only the
// file name is trusted, matched case-insensitively against the files that were actually dropped.
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { MODEL_LIMITS } from '@kitforge/shared-types';

/** Textures are shrunk to this edge by default: sharp on a game piece, light for 8 players. */
export const TEXTURE_TARGET_PX = 2048;
const IMAGE = /\.(png|jpe?g|webp|gif|bmp|tga)$/i;
const baseName = (path: string) => path.split(/[\\/]/).pop()!.toLowerCase();

interface MtlDef { name: string; color?: [number, number, number]; map?: string; normal?: string; opacity?: number }

/** The few .mtl lines that survive into a glTF: colour, colour texture, normal map, opacity. */
function parseMtl(text: string): Map<string, MtlDef> {
  const out = new Map<string, MtlDef>();
  let cur: MtlDef | null = null;
  // A map line may carry options before the file name (-s 1 1 1 -bm 0.5 wood.png); the file
  // name is whatever follows the last option, and may contain spaces.
  const fileOf = (rest: string) => rest.replace(/^(\s*-\w+(\s+(on|off|[-\d.]+))*)*\s*/i, '').trim();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [key, ...parts] = line.split(/\s+/);
    const rest = line.slice(key.length);
    const k = key.toLowerCase();
    if (k === 'newmtl') { cur = { name: rest.trim() }; out.set(cur.name, cur); continue; }
    if (!cur) continue;
    if (k === 'kd') cur.color = [Number(parts[0]), Number(parts[1]), Number(parts[2])];
    else if (k === 'map_kd') cur.map = fileOf(rest);
    else if (k === 'norm' || k === 'map_kn') cur.normal = fileOf(rest);
    else if (k === 'd') cur.opacity = Number(parts[0]);
    else if (k === 'tr') cur.opacity = 1 - Number(parts[0]);
  }
  return out;
}

/** Every dropped file, plus everything inside any dropped .zip, by lower-case file name. Two
 *  files with the same name in different folders (a "2P" colour variant, say): the one nearest
 *  the top of the zip wins, since that's the one sitting next to the .obj. */
async function gather(files: File[]): Promise<Map<string, Blob>> {
  const all = new Map<string, Blob>();
  const depthOf = new Map<string, number>();
  const put = (path: string, blob: Blob) => {
    const key = baseName(path), depth = path.split(/[\\/]/).length;
    if ((depthOf.get(key) ?? Infinity) <= depth) return;
    all.set(key, blob); depthOf.set(key, depth);
  };
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const entries = unzipSync(new Uint8Array(await f.arrayBuffer()));
      for (const [path, data] of Object.entries(entries)) {
        if (path.endsWith('/') || path.startsWith('__MACOSX/')) continue;
        put(path, new Blob([data]));
      }
    } else put(f.name, f);
  }
  return all;
}

export interface BundleResult {
  /** The baked .glb, ready for the normal model checks and upload. */
  file: File;
  /** Texture names the .mtl asked for but that weren't dropped. */
  missing: string[];
}

/** Largest texture edge in the bundle (0 if it has none) — asked before baking, so the student
 *  can choose whether big textures get shrunk. */
export async function largestTexture(files: File[]): Promise<number> {
  const all = await gather(files);
  let max = 0;
  for (const [name, blob] of all) {
    if (!IMAGE.test(name)) continue;
    try { const bmp = await createImageBitmap(blob); max = Math.max(max, bmp.width, bmp.height); bmp.close(); } catch { /* skipped later */ }
  }
  return max;
}

export const isObjBundle = (files: File[]) => files.some(f => /\.(obj|zip)$/i.test(f.name));

export async function objBundleToGlb(files: File[], opts: { shrink: boolean }): Promise<BundleResult> {
  const all = await gather(files);
  const objName = [...all.keys()].find(n => n.endsWith('.obj'));
  if (!objName) throw new Error('No .obj file found — drop the .obj together with its .mtl and images, or a .zip of them.');
  const objText = await all.get(objName)!.text();

  // The .mtl the .obj names (mtllib), else the only .mtl there is.
  const mtlRef = /^\s*mtllib\s+(.+)$/m.exec(objText)?.[1].trim();
  const mtlBlob = (mtlRef && all.get(baseName(mtlRef))) || [...all].find(([n]) => n.endsWith('.mtl'))?.[1];
  const mtls = mtlBlob ? parseMtl(await mtlBlob.text()) : new Map<string, MtlDef>();

  const missing = new Set<string>();
  const textures = new Map<string, Promise<THREE.Texture | null>>();
  const texture = (ref: string | undefined, color: boolean) => {
    if (!ref) return Promise.resolve(null);
    const key = baseName(ref);
    if (!textures.has(key)) {
      textures.set(key, (async () => {
        const blob = all.get(key);
        if (!blob) { missing.add(ref.split(/[\\/]/).pop()!); return null; }
        try {
          const bmp = await createImageBitmap(blob);
          const tex = new THREE.Texture(bmp as unknown as HTMLImageElement);
          tex.flipY = true; // OBJ texture coordinates start bottom-left
          // OBJ texture coordinates may run far past 0–1 (game rips tile tiny textures dozens of
          // times); every OBJ tool repeats them, so clamping would smear one edge colour instead.
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          if (color) tex.colorSpace = THREE.SRGBColorSpace;
          // Big photos go into the .glb as JPEG (a fraction of the size). Small textures stay PNG
          // (JPEG smudges pixel art and saves nothing), and so do images with see-through parts.
          const small = Math.max(bmp.width, bmp.height) <= 512;
          tex.userData.mimeType = small || (/\.png$/i.test(key) && hasAlpha(bmp)) ? 'image/png' : 'image/jpeg';
          tex.needsUpdate = true;
          return tex;
        } catch { missing.add(ref.split(/[\\/]/).pop()!); return null; }
      })());
    }
    return textures.get(key)!;
  };

  const materialFor = async (name: string): Promise<THREE.Material> => {
    const def = mtls.get(name);
    // No .mtl but exactly one image dropped: that's the texture for the whole model.
    const loneImage = !mtls.size ? [...all.keys()].filter(n => IMAGE.test(n)) : [];
    const map = await texture(def?.map ?? (loneImage.length === 1 ? loneImage[0] : undefined), true);
    const normalMap = await texture(def?.normal, false);
    const opacity = def?.opacity !== undefined && def.opacity < 1 ? Math.max(0.05, def.opacity) : 1;
    const seeThrough = !!map && hasAlpha(map.image as ImageBitmap);
    return new THREE.MeshStandardMaterial({
      name,
      color: map ? 0xffffff : def?.color ? new THREE.Color().setRGB(...def.color, THREE.SRGBColorSpace) : 0xd9d4c7,
      map, normalMap, roughness: 0.7, metalness: 0,
      transparent: opacity < 1, opacity,
      alphaTest: seeThrough ? 0.5 : 0,
    });
  };

  const root = new OBJLoader().parse(objText);
  const made = new Map<string, Promise<THREE.Material>>();
  const meshes: THREE.Mesh[] = [];
  root.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  for (const mesh of meshes) {
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const swapped = await Promise.all(list.map(m => {
      const name = m?.name ?? '';
      if (!made.has(name)) made.set(name, materialFor(name));
      return made.get(name)!;
    }));
    mesh.material = Array.isArray(mesh.material) ? swapped : swapped[0];
  }

  for (const mesh of meshes) fixTexelUVs(mesh);

  const scene = new THREE.Scene();
  scene.add(root);
  scene.updateMatrixWorld(true);
  const glb = await new GLTFExporter().parseAsync(scene, {
    binary: true,
    maxTextureSize: opts.shrink ? TEXTURE_TARGET_PX : MODEL_LIMITS.maxTexturePx,
  }) as ArrayBuffer;
  for (const t of await Promise.all(textures.values())) { (t?.image as ImageBitmap | undefined)?.close?.(); t?.dispose(); }
  return { file: new File([glb], objName.replace(/\.obj$/i, '.glb'), { type: 'model/gltf-binary' }), missing: [...missing] };
}

/** Some exporters — game-model rips especially (N64 tools) — write a share of their triangles'
 *  texture positions in raw texel units instead of 0–1: (44, −75) where (0.69, 0.06) is meant.
 *  Tiled, those triangles show a texture repeated dozens of times as fine stripes. A triangle
 *  whose coordinates are all whole numbers and reach outside 0–1 is one of them: it is scaled
 *  back by the smallest power-of-two multiple of its texture's size that fits, flipped the way
 *  those tools measure v (downward from the top). Ordinary models never match, so they're untouched. */
function fixTexelUVs(mesh: THREE.Mesh) {
  const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv || mesh.geometry.index) return;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const groups = mesh.geometry.groups.length ? mesh.geometry.groups : [{ start: 0, count: uv.count, materialIndex: 0 }];
  const whole = (x: number) => Math.abs(x - Math.round(x)) < 1e-4;
  for (const g of groups) {
    const img = (mats.at(g.materialIndex ?? 0) as THREE.MeshStandardMaterial | undefined)?.map?.image as { width?: number; height?: number } | undefined;
    const w = img?.width, h = img?.height;
    if (!w || !h) continue;
    const odd: number[] = [];
    let reach = 1;
    for (let t = g.start; t + 2 < g.start + g.count; t += 3) {
      const idx = [t, t + 1, t + 2];
      const us = idx.map(i => uv.getX(i)), vs = idx.map(i => uv.getY(i));
      if (![...us, ...vs].every(whole) || [...us, ...vs].every(x => x >= -1e-4 && x <= 1 + 1e-4)) continue;
      odd.push(t);
      for (const x of us) reach = Math.max(reach, Math.abs(x) / w);
      for (const y of vs) reach = Math.max(reach, Math.abs(y) / h);
    }
    if (!odd.length) continue;
    const k = 2 ** Math.ceil(Math.log2(reach));
    for (const t of odd) for (let i = t; i < t + 3; i++) uv.setXY(i, uv.getX(i) / (k * w), 1 + uv.getY(i) / (k * h));
    uv.needsUpdate = true;
  }
}

/** Any pixel not fully opaque? Checked on a small copy — plenty to spot a cut-out. */
function hasAlpha(bmp: ImageBitmap): boolean {
  const s = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 250) return true;
  return false;
}
