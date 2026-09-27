// Canvas textures for markers and notes, cached by their visible content.
import * as THREE from 'three';
import type { SyncedMarker } from '../net/stateTypes.ts';

export const MARKER_COLORS: Record<SyncedMarker['kind'], string> = {
  plus: '#43c07a',
  minus: '#e25555',
  damage: '#ff8c42',
  status: '#9b7bff',
  custom: '#ffd24a',
  die: '#fdf6e3',
  diePips: '#fdf6e3',
  d4: '#fdf6e3',
  d8: '#fdf6e3',
  d10: '#fdf6e3',
  d12: '#fdf6e3',
  d20: '#fdf6e3',
};

export function markerText(m: Pick<SyncedMarker, 'kind' | 'label' | 'value'>) {
  switch (m.kind) {
    case 'plus': return `+${m.value}`;
    case 'minus': return `−${m.value}`;
    case 'damage': return `${m.value}`;
    default: return m.value ? `${m.label} ${m.value}` : m.label;
  }
}

const cache = new Map<string, THREE.Texture>();
const materials = new Map<string, THREE.MeshStandardMaterial>();

function materialFor(key: string, make: () => THREE.Texture, roughness: number) {
  let m = materials.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ map: make(), roughness }); materials.set(key, m); }
  return m;
}
export const markerMaterial = (m: Pick<SyncedMarker, 'kind' | 'label' | 'value'>) => materialFor(`m|${m.kind}|${markerText(m)}`, () => markerTexture(m), 0.55);
export const noteMaterial = (text: string, author: string) => materialFor(`n|${author}|${text}`, () => noteTexture(text, author), 0.9);

function finish(key: string, canvas: HTMLCanvasElement) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (cache.size > 400) cache.clear();
  cache.set(key, tex);
  return tex;
}

export function markerTexture(m: Pick<SyncedMarker, 'kind' | 'label' | 'value'>) {
  const text = markerText(m), key = `m|${m.kind}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = MARKER_COLORS[m.kind];
  g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#10121a'; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (m.kind === 'damage') {
    g.font = 'bold 54px system-ui, sans-serif'; g.fillText(text, 64, 56);
    g.font = 'bold 20px system-ui, sans-serif'; g.fillText('DMG', 64, 96);
  } else {
    const size = text.length <= 3 ? 56 : text.length <= 6 ? 32 : 22;
    g.font = `bold ${size}px system-ui, sans-serif`;
    g.fillText(text.slice(0, 12), 64, 66);
  }
  return finish(key, c);
}

/** A standard d6: each face carries its own number, opposite faces sum to 7 (1↔6, 2↔5, 3↔4) —
 * the same convention as a real die. BoxGeometry's face order is +x,-x,+y,-y,+z,-z, so this array
 * IS the face mapping DIE_FACE_ROTATIONS below is built against; the two must stay in sync. */
const DIE_FACE_VALUES = [1, 6, 2, 5, 3, 4] as const;

/** Standard pip layouts on a 3×3 grid, same as a physical die. */
const PIP_LAYOUTS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};
const PIP_POS = [26, 64, 102];

function dieFaceCanvas(value: number, pips: boolean) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fdf6e3'; g.fillRect(0, 0, 128, 128);
  g.beginPath(); g.roundRect(6, 6, 116, 116, 18); g.strokeStyle = '#da291c'; g.lineWidth = 5; g.stroke();
  g.fillStyle = '#1c1c28';
  if (pips) {
    for (const [col, row] of PIP_LAYOUTS[value] ?? []) {
      g.beginPath(); g.arc(PIP_POS[col], PIP_POS[row], 11, 0, Math.PI * 2); g.fill();
    }
  } else {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 68px system-ui, sans-serif';
    g.fillText(String(value), 64, 68);
  }
  return c;
}

function dieFaceTexture(value: number, pips: boolean) {
  const key = `d|${pips ? 'p' : 'n'}|${value}`;
  const hit = cache.get(key);
  if (hit) return hit;
  return finish(key, dieFaceCanvas(value, pips));
}

const dieFaces = new Map<boolean, THREE.MeshStandardMaterial[]>();
/** The 6 fixed face materials, in BoxGeometry's own face order — same array every render. */
export function dieFaceMaterials(pips: boolean) {
  let faces = dieFaces.get(pips);
  if (!faces) { faces = DIE_FACE_VALUES.map(v => new THREE.MeshStandardMaterial({ map: dieFaceTexture(v, pips), roughness: 0.35 })); dieFaces.set(pips, faces); }
  return faces;
}

function wrap(g: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > width && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export function noteTexture(text: string, author: string) {
  const key = `n|${author}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 400; c.height = 280;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffe98a'; g.fillRect(0, 0, 400, 280);
  g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, 0, 400, 26);
  g.fillStyle = '#2b2410';
  g.font = '22px system-ui, sans-serif';
  const lines = wrap(g, text, 360);
  lines.slice(0, 8).forEach((l, i) => g.fillText(i === 7 && lines.length > 8 ? `${l}…` : l, 20, 58 + i * 27));
  g.font = 'bold 16px system-ui, sans-serif'; g.fillStyle = '#6b5a1e';
  g.fillText(`— ${author}`, 20, 266);
  return finish(key, c);
}
