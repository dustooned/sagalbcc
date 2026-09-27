// A 3D model from Blender (.glb) straight onto the table. Checked here first with a real 3D
// loader so a student gets an instant, specific "here's how to fix it in Blender" instead of a
// failed upload — the server then re-checks it independently before storing it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MODEL_LIMITS, UNSUPPORTED_GLTF_EXTENSIONS, modelProblems, type ModelProblem, type NormalizedKit, type PieceDefinition } from '@kitforge/shared-types';
import { uploadModel } from '../net/api.ts';
import { store } from '../net/tableStore.ts';
import { actions } from './actions.ts';

/** A dropped model lands at a sensible size: its larger footprint side this many inches. */
const TARGET_SIDE_INCHES = 3;

/** Problems visible in the glTF JSON — external files or Draco compression — that the loader would
 *  otherwise report as an error a student can't act on. */
function jsonProblem(buf: ArrayBuffer): ModelProblem | null {
  const view = new DataView(buf);
  if (buf.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) return null;
  const len = view.getUint32(12, true);
  try {
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len))) as { buffers?: { uri?: string }[]; images?: { uri?: string }[]; extensionsRequired?: string[] };
    if ((json.extensionsRequired ?? []).some(x => UNSUPPORTED_GLTF_EXTENSIONS.includes(x))) return modelProblems.compressed();
    const external = (u?: string) => u !== undefined && !u.startsWith('data:');
    if ((json.buffers ?? []).some(b => external(b.uri)) || (json.images ?? []).some(i => external(i.uri))) return modelProblems.externalFiles();
  } catch { /* the loader below reports it */ }
  return null;
}

async function inspect(file: File): Promise<{ problem: ModelProblem } | { footprint: { w: number; h: number } }> {
  if (!/\.glb$/i.test(file.name)) return { problem: modelProblems.wrongFormat(file.name) };
  const mb = file.size / 1024 / 1024;
  if (mb > MODEL_LIMITS.maxMB) return { problem: modelProblems.tooBig(mb) };
  const buf = await file.arrayBuffer();
  const early = jsonProblem(buf);
  if (early) return { problem: early };

  let scene: THREE.Object3D;
  try { scene = (await new GLTFLoader().parseAsync(buf, '')).scene; } catch { return { problem: modelProblems.unreadable() }; }
  let tris = 0, meshes = 0, maxTex = 0;
  scene.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes++;
    const g = mesh.geometry;
    tris += (g.index ? g.index.count : g.getAttribute('position')?.count ?? 0) / 3;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const v of Object.values(m ?? {})) {
        const img = (v as THREE.Texture | null)?.isTexture ? (v as THREE.Texture).image as { width?: number; height?: number } | undefined : undefined;
        if (img) maxTex = Math.max(maxTex, img.width ?? 0, img.height ?? 0);
      }
    }
  });
  if (!meshes) return { problem: modelProblems.empty() };
  if (tris > MODEL_LIMITS.maxTriangles) return { problem: modelProblems.tooManyTriangles(Math.round(tris)) };
  if (maxTex > MODEL_LIMITS.maxTexturePx) return { problem: modelProblems.textureTooLarge(maxTex) };

  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  const big = Math.max(size.x, size.z) || 1;
  return { footprint: { w: Math.max(0.3, (size.x / big) * TARGET_SIDE_INCHES), h: Math.max(0.3, (size.z / big) * TARGET_SIDE_INCHES) } };
}

/** OBJ and STL arrive as shape only (one plain color) and are turned into a .glb here, so the
 *  server and every other player only ever deal with one format. */
const SHAPE_ONLY = /\.(obj|stl)$/i;
const plainMaterial = () => new THREE.MeshStandardMaterial({ color: '#d9d4c7', roughness: 0.6 });

async function toGlb(file: File): Promise<File> {
  let root: THREE.Object3D;
  if (/\.stl$/i.test(file.name)) {
    const geo = new STLLoader().parse(await file.arrayBuffer());
    geo.computeVertexNormals();
    root = new THREE.Mesh(geo, plainMaterial());
    root.rotation.x = -Math.PI / 2; // STL files are Z-up (3D printing); the table is Y-up
  } else {
    root = new OBJLoader().parse(await file.text());
    root.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = plainMaterial(); });
  }
  const scene = new THREE.Scene();
  scene.add(root);
  scene.updateMatrixWorld(true);
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true }) as ArrayBuffer;
  return new File([glb], file.name.replace(/\.[^.]+$/, '.glb'), { type: 'model/gltf-binary' });
}

export async function addModelFile(file: File) {
  if (store.kitProgress) return;
  store.kitProgress = 'Checking model…';
  store.bump();
  try {
    if (SHAPE_ONLY.test(file.name)) {
      try { file = await toGlb(file); } catch { store.showHelp(modelProblems.unreadable()); return; }
    }
    const result = await inspect(file);
    if ('problem' in result) { store.showHelp(result.problem); return; }
    store.kitProgress = 'Uploading model…';
    store.bump();
    const { assetUrl } = await uploadModel(file);
    const id = `mdl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const name = file.name.replace(/\.[^.]+$/, '') || 'Model';
    const def: PieceDefinition = { id, kind: 'piece', name, frontImage: '', model: assetUrl, ...result.footprint };
    const kit: NormalizedKit = { name, pieces: [{ pieceId: id, quantity: 1 }] };
    actions.loadKit(kit, [def]);
    store.notify(`Added “${name}” to the table.`);
  } catch (err) {
    const e = err as Error & { fix?: string };
    if (e.fix) store.showHelp({ error: e.message, fix: e.fix });
    else store.notify(e.message);
  } finally {
    store.kitProgress = null;
    store.bump();
  }
}

export function pickModelFile() {
  // Accept anything so a wrong format (.blend, .fbx, .gltf…) gets the export steps, not silence.
  const input = Object.assign(document.createElement('input'), { type: 'file' });
  input.onchange = () => { const f = input.files?.[0]; if (f) void addModelFile(f); };
  input.click();
}
