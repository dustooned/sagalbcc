// "Tip it over" should look like a figure lying on the table: face down on its chest, on its
// back, on a side — not hovering, and not propped up on the tip of a sword or racket it holds
// out. So a tipped model keeps exactly the pose the student picked and rests on its BODY: scanning
// up from its lowest point, the first level where it's wide (a real part of the body, not a thin
// tip) is where the table goes. Thin bits below that level sink into the felt, as they would
// look in a photo of a toy lying on a rug.
import * as THREE from 'three';

/** A slice counts as "body" once it's at least this share of the model's whole footprint. */
const BODY_SHARE = 0.12;
/** Each slice is this share of the model's height. */
const SLICE = 0.03;

/** The height (in the model's current world space) that should sit on the table. */
export function restHeight(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  // Every vertex and every triangle's centre: dense enough to see a body's outline, with no
  // randomness, so every player's table shows exactly the same pose.
  const pts: THREE.Vector3[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos) return;
    const m = mesh.matrixWorld, index = mesh.geometry.index;
    for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m));
    const tris = index ? index.count / 3 : pos.count / 3;
    for (let t = 0; t < tris; t++) {
      const [i0, i1, i2] = index ? [index.getX(3 * t), index.getX(3 * t + 1), index.getX(3 * t + 2)] : [3 * t, 3 * t + 1, 3 * t + 2];
      a.fromBufferAttribute(pos, i0).applyMatrix4(m); b.fromBufferAttribute(pos, i1).applyMatrix4(m); c.fromBufferAttribute(pos, i2).applyMatrix4(m);
      pts.push(a.clone().add(b).add(c).divideScalar(3));
    }
  });
  if (!pts.length) return 0;
  // Very dense models: every n-th point is still plenty to see where the body is.
  if (pts.length > 40000) { const n = Math.ceil(pts.length / 40000); for (let i = 0, j = 0; i < pts.length; i += n) pts[j++] = pts[i]; pts.length = Math.ceil(pts.length / n); }
  const box = new THREE.Box3().setFromPoints(pts);
  const size = box.getSize(new THREE.Vector3());
  const whole = Math.max(1e-9, size.x * size.z);
  const band = Math.max(1e-6, size.y * SLICE);
  pts.sort((p, q) => p.y - q.y);
  // Slide a slice up from the bottom; the first one whose footprint is body-sized is the rest.
  let lo = 0;
  for (let hi = 0; hi < pts.length; hi++) {
    while (pts[hi].y - pts[lo].y > band) lo++;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = lo; i <= hi; i++) { const p = pts[i]; if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z; }
    if ((x1 - x0) * (z1 - z0) >= BODY_SHARE * whole) return pts[lo].y;
  }
  return box.min.y;
}
