// General machinery for any Platonic-solid die (d4, d8, d12, d20). d6 keeps its own simpler
// box-face system in tokenTextures.ts/Marker3D.tsx. d10 doesn't go through here either — a
// pentagonal trapezohedron isn't a Platonic solid, so it needs hand-built geometry, not this.
import * as THREE from 'three';

interface DieFaceGroup {
  normal: THREE.Vector3;
  /** Non-indexed vertex index (start of each triangle, 3 consecutive = one triangle) in this face. */
  triStarts: number[];
}

/** Non-indexed triangle soup -> one group per planar face, by matching triangle normals. Works
 * for single-triangle faces (tetrahedron/octahedron/icosahedron) and multi-triangle faces
 * (dodecahedron's pentagons) alike — no need to know the geometry's internal triangulation. */
function groupFaces(geo: THREE.BufferGeometry): DieFaceGroup[] {
  const pos = geo.getAttribute('position');
  const triCount = pos.count / 3;
  const faces: DieFaceGroup[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    const i = t * 3;
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    ab.subVectors(b, a); ac.subVectors(c, a);
    n.crossVectors(ab, ac).normalize();
    const face = faces.find(f => f.normal.dot(n) > 0.999);
    if (face) face.triStarts.push(i);
    else faces.push({ normal: n.clone(), triStarts: [i] });
  }
  return faces;
}

/** A tetrahedron's 4 faces have no true opposite (no two are parallel), so it just numbers them
 * in discovery order. Every other Platonic solid here is centrally symmetric — every face has a
 * true antipodal partner — so opposite faces are paired and numbered to sum to `sum`, the same
 * convention real dice use (e.g. a d20's opposite faces sum to 21). */
function assignValues(faces: DieFaceGroup[], sum: number): number[] {
  const n = faces.length;
  if (sum <= 0) return faces.map((_, i) => i + 1);
  const opposite = faces.map((f, i) => {
    let best = i, bestDot = 1;
    faces.forEach((g, j) => { if (j === i) return; const d = f.normal.dot(g.normal); if (d < bestDot) { bestDot = d; best = j; } });
    return best;
  });
  const values = new Array<number>(n).fill(0);
  const done = new Array<boolean>(n).fill(false);
  let next = 1;
  for (let i = 0; i < n; i++) {
    if (done[i]) continue;
    const j = opposite[i];
    values[i] = next; values[j] = sum - next;
    done[i] = done[j] = true;
    next++;
  }
  return values;
}

export interface PolyDie {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** The rotation that brings the given rolled value's face to point world-up (+Y). */
  quaternionFor: (value: number) => THREE.Quaternion;
}

/** Builds a die from any Platonic-solid base geometry: groups its faces, numbers them (respecting
 * the opposite-sum convention where one exists), bakes a numeral atlas texture, and UV-maps each
 * face into its own atlas cell using a 2D basis of that face's own plane — so the numeral sits
 * flat and centered no matter how the face is oriented in 3D. */
export function buildPolyhedronDie(base: THREE.BufferGeometry, sides: number, oppositeSum: number): PolyDie {
  const geo = base.toNonIndexed();
  const faces = groupFaces(geo);
  if (faces.length !== sides) throw new Error(`Expected ${sides} faces, found ${faces.length}`);
  const values = assignValues(faces, oppositeSum);

  const cols = Math.ceil(Math.sqrt(sides)), rows = Math.ceil(sides / cols), cell = 128;
  const canvas = document.createElement('canvas');
  canvas.width = cols * cell; canvas.height = rows * cell;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fdf6e3'; g.fillRect(0, 0, canvas.width, canvas.height);
  for (let v = 1; v <= sides; v++) {
    const idx = v - 1, cx = (idx % cols) * cell, cy = Math.floor(idx / cols) * cell;
    g.strokeStyle = '#da291c'; g.lineWidth = 4;
    g.strokeRect(cx + 4, cy + 4, cell - 8, cell - 8);
    g.fillStyle = '#1c1c28'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${sides > 12 ? 40 : 44}px system-ui, sans-serif`;
    g.fillText(String(v), cx + cell / 2, cy + cell / 2 + 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const p = new THREE.Vector3();
  faces.forEach((face, fi) => {
    const idx = values[fi] - 1, cx = (idx % cols) / cols, cy = Math.floor(idx / cols) / rows;
    const cw = 1 / cols, ch = 1 / rows;
    const nrm = face.normal;
    const ref = Math.abs(nrm.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(ref, nrm).normalize();
    const v = new THREE.Vector3().crossVectors(nrm, u).normalize();
    const pts: { i: number; pu: number; pv: number }[] = [];
    for (const start of face.triStarts) {
      for (let k = 0; k < 3; k++) {
        const i = start + k;
        p.fromBufferAttribute(pos, i);
        pts.push({ i, pu: p.dot(u), pv: p.dot(v) });
      }
    }
    const us = pts.map(pt => pt.pu), vs = pts.map(pt => pt.pv);
    const minU = Math.min(...us), maxU = Math.max(...us), minV = Math.min(...vs), maxV = Math.max(...vs);
    const spanU = Math.max(maxU - minU, 1e-6), spanV = Math.max(maxV - minV, 1e-6);
    for (const pt of pts) {
      const lu = 0.15 + 0.7 * ((pt.pu - minU) / spanU);
      const lv = 0.15 + 0.7 * ((pt.pv - minV) / spanV);
      uv[pt.i * 2] = cx + lu * cw;
      uv[pt.i * 2 + 1] = cy + (1 - lv) * ch; // canvas Y is down, UV Y is up
    }
  });
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.4 });
  const UP = new THREE.Vector3(0, 1, 0);
  return {
    geometry: geo,
    material,
    quaternionFor: value => {
      const fi = Math.max(0, values.indexOf(value));
      return new THREE.Quaternion().setFromUnitVectors(faces[fi].normal, UP);
    },
  };
}

/** Shoemake's uniform-random-rotation algorithm — an unbiased random orientation, used for the
 * mid-roll tumble (quaternions can't just "add extra turns" the way Euler angles can). */
export function randomQuaternion(target: THREE.Quaternion): THREE.Quaternion {
  const u1 = Math.random(), u2 = Math.random(), u3 = Math.random();
  const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
  return target.set(s1 * Math.sin(2 * Math.PI * u2), s1 * Math.cos(2 * Math.PI * u2), s2 * Math.sin(2 * Math.PI * u3), s2 * Math.cos(2 * Math.PI * u3));
}
