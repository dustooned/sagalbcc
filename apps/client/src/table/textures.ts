// Shared textures and materials: one material per distinct image, reused by every copy of a
// piece, so a table with 100+ pieces stays cheap.
import * as THREE from 'three';
import type { PieceFace } from '@kitforge/shared-types';
import { assetUrl } from '../config.ts';
import { gifTexture, isGif, isVideo, videoTexture } from './animatedTextures.ts';

const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');

const textures = new Map<string, THREE.Texture>();
const materials = new Map<string, THREE.MeshStandardMaterial>();

function finish(tex: THREE.Texture) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
function imageTexture(url: string) {
  let tex = textures.get(url);
  if (!tex) {
    tex = isGif(url) ? gifTexture(url, finish) : isVideo(url) ? videoTexture(url, finish) : finish(loader.load(url));
    textures.set(url, tex);
  }
  return tex;
}
function material(key: string, make: () => THREE.Texture) {
  let m = materials.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ map: make(), roughness: 0.75, metalness: 0, transparent: true }); materials.set(key, m); }
  return m;
}

let fallbackBack: THREE.Texture | null = null;
function generatedBack() {
  if (fallbackBack) return fallbackBack;
  const c = document.createElement('canvas');
  c.width = 250; c.height = 350;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1c1c28'; g.fillRect(0, 0, 250, 350);
  g.strokeStyle = '#e0533d'; g.lineWidth = 8; g.strokeRect(14, 14, 222, 322);
  g.fillStyle = '#fff9eb'; g.font = 'bold 26px system-ui'; g.textAlign = 'center';
  g.fillText('KIT', 125, 165); g.fillStyle = '#e0533d'; g.fillText('FORGE', 125, 200);
  fallbackBack = finish(new THREE.CanvasTexture(c));
  return fallbackBack;
}

let fallbackFront: THREE.Texture | null = null;
function generatedFront() {
  if (fallbackFront) return fallbackFront;
  const c = document.createElement('canvas');
  c.width = 250; c.height = 350;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff9eb'; g.fillRect(0, 0, 250, 350);
  g.strokeStyle = '#d8d2c2'; g.lineWidth = 3; g.setLineDash([8, 6]); g.strokeRect(20, 20, 210, 310); g.setLineDash([]);
  g.fillStyle = '#8b8578'; g.font = '16px system-ui'; g.textAlign = 'center';
  g.fillText('no art yet', 125, 180);
  fallbackFront = finish(new THREE.CanvasTexture(c));
  return fallbackFront;
}

const highlightTextures = new Map<string, THREE.CanvasTexture>();
/** A soft glowing ring (not a flat filled block) for a selected/locked piece's outline. */
function highlightTexture(color: string) {
  let tex = highlightTextures.get(color);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 40, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0)');
  grad.addColorStop(0.86, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  tex = new THREE.CanvasTexture(c);
  highlightTextures.set(color, tex);
  return tex;
}
const highlightMaterials = new Map<string, THREE.MeshBasicMaterial>();
export function highlightMaterial(color: string) {
  let m = highlightMaterials.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map: highlightTexture(color), transparent: true, depthWrite: false });
    highlightMaterials.set(color, m);
  }
  return m;
}

export function backMaterial(backImage: string) {
  return backImage ? material(`back:${backImage}`, () => imageTexture(assetUrl(backImage))) : material('back:generated', generatedBack);
}
export function frontMaterial(face: PieceFace | null) {
  if (!face?.frontImage) return material('front:generated', generatedFront);
  return material(`img:${face.frontImage}`, () => imageTexture(assetUrl(face.frontImage)));
}
/** A token drawn only where its picture is: fully clear pixels are cut out, so a transparent PNG,
 *  GIF or WebM shows the table through it instead of the piece's slab. */
const cutouts = new Map<string, THREE.MeshStandardMaterial>();
export function cutoutMaterial(image: string) {
  let m = cutouts.get(image);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: imageTexture(assetUrl(image)), roughness: 0.75, metalness: 0, alphaTest: 0.35 });
    cutouts.set(image, m);
  }
  return m;
}
/** The slab's sides, hidden for cut-out tokens. */
export const hiddenMaterial = new THREE.MeshBasicMaterial({ visible: false });

export const edgeMaterial = new THREE.MeshStandardMaterial({ color: '#e9e4d6', roughness: 0.9 });
export const boardEdgeMaterial = new THREE.MeshStandardMaterial({ color: '#c9c2ae', roughness: 0.9 });
