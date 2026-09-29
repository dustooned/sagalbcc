// How a die looks while it moves — purely visual (the server decides the number). One model for
// every die shape, so a d6 and a d20 behave the same:
//
//  • Rolling: a die travelling across the felt turns about the axis perpendicular to its motion,
//    at the rate a real die would roll (distance / radius). Throwing it makes it roll the way it
//    was thrown, and it slows down with the slide instead of spinning on its own schedule.
//  • A roll (tap, shake or throw) kicks in some random spin and a small hop that bounces.
//  • Settling: once it's nearly still it tips onto the rolled face, choosing the heading closest
//    to where it already faces, so it lands rather than snapping round.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const GRAVITY = 22;           // units/s² — a quick, weighty hop at table scale
const HOP_SPEED = 3.4;        // initial upward speed of a roll's hop
const BOUNCE = 0.38;          // fraction of speed kept per bounce
const KICK_MIN = 11, KICK_RANGE = 7; // rad/s of random spin a roll adds
const ROLL_GRIP = 10;         // how quickly spin follows travel on the felt
const SPIN_FRICTION = 2.6;    // free spin decay per second
const SETTLE_SPIN = 6;        // below this spin (rad/s) and…
const SETTLE_SPEED = 0.35;    // …below this travel speed (units/s), it tips onto its face
const MAX_SPIN = 26;          // rad/s
// Tipping onto a face: a spring that pulls toward flat, lightly damped, so the die falls over
// (quickening as it goes) and rocks once before resting — like a real die, not a magnet.
const TIP_PULL = 240;         // rad/s² per radian away from flat
const TIP_DAMP = 20;          // per second — about one small rock, then still

export interface DieMotion {
  q: THREE.Quaternion;         // world orientation
  spin: THREE.Vector3;         // angular velocity, world axis × rad/s
  prev: THREE.Vector3 | null;  // last position, for travel speed
  hop: number; hopV: number;   // height above rest and its vertical speed
  settling: boolean;           // tipping onto its face — keeps going until the next roll or throw
}

export const newDieMotion = (start: THREE.Quaternion): DieMotion =>
  ({ q: start.clone(), spin: new THREE.Vector3(), prev: null, hop: 0, hopV: 0, settling: false });

const tmpV = new THREE.Vector3(), tmpAxis = new THREE.Vector3(), dq = new THREE.Quaternion(), yawQ = new THREE.Quaternion();
const aim = new THREE.Vector3(), have = new THREE.Vector3(), tmpQ = new THREE.Quaternion();

/** A roll happened: random spin plus a hop (smaller while held in the hand). */
export function kickDie(m: DieMotion, inHand: boolean) {
  tmpV.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
  m.spin.addScaledVector(tmpV, KICK_MIN + Math.random() * KICK_RANGE);
  m.settling = false;
  if (!inHand) m.hopV = Math.max(m.hopV, HOP_SPEED * (0.8 + Math.random() * 0.4));
}

/** The face-up orientation turned about the vertical to face as close as possible to `q`. */
function nearestRest(face: THREE.Quaternion, q: THREE.Quaternion, out: THREE.Quaternion) {
  // Compare where a horizontal reference axis points now vs. at rest, on the table plane.
  for (const ref of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)]) {
    have.copy(ref).applyQuaternion(q).setY(0);
    aim.copy(ref).applyQuaternion(face).setY(0);
    if (have.lengthSq() > 0.05 && aim.lengthSq() > 0.05) {
      const angle = Math.atan2(aim.x, aim.z) - Math.atan2(have.x, have.z);
      return out.copy(yawQ.setFromAxisAngle(UP, -angle)).multiply(face);
    }
  }
  return out.copy(face);
}

const rest = new THREE.Quaternion();

/**
 * Advances one frame. `pos` is where the die is drawn this frame (already smoothed), `radius` its
 * rolling radius, `face` the orientation showing the current value. Returns the hop height.
 */
/** How far the die's lowest corner sits below its centre, turned by `q` (the hull is die-local). */
function lowest(hull: THREE.Vector3[], q: THREE.Quaternion) {
  let min = Infinity;
  for (const v of hull) min = Math.min(min, tmpV.copy(v).applyQuaternion(q).y);
  return -min;
}

const delta = new THREE.Quaternion(), pull = new THREE.Vector3();

/**
 * Advances one frame. `pos` is where the die is drawn this frame (already smoothed), `radius` its
 * rolling radius, `face` the orientation showing the current value, `hull` its corner points.
 * Returns how far to raise the die this frame: its hop, plus however much a tilted die stands
 * taller on an edge or corner than lying flat — so it rocks on the felt instead of sinking in.
 */
export function stepDie(m: DieMotion, pos: THREE.Vector3, dt: number, radius: number, face: THREE.Quaternion, inHand: boolean, hull: THREE.Vector3[]): number {
  dt = Math.min(dt, 0.05);
  // Travel on the table plane since last frame.
  let speed = 0;
  if (m.prev && dt > 0) {
    tmpV.subVectors(pos, m.prev).setY(0).divideScalar(dt);
    speed = tmpV.length();
    if (!inHand && m.hop < 0.02 && speed > 0.2) {
      // Rolling without slipping: ω = (up × v) / r.
      tmpAxis.crossVectors(UP, tmpV).divideScalar(radius);
      m.spin.lerp(tmpAxis, 1 - Math.exp(-dt * ROLL_GRIP));
    }
  }
  (m.prev ??= new THREE.Vector3()).copy(pos);

  // Hop and bounce.
  if (m.hop > 0 || m.hopV > 0) {
    m.hopV -= GRAVITY * dt;
    m.hop += m.hopV * dt;
    if (m.hop <= 0) { m.hop = 0; m.hopV = Math.abs(m.hopV) > 1.2 ? -m.hopV * BOUNCE : 0; }
  }

  m.spin.multiplyScalar(Math.exp(-dt * (inHand ? 1.2 : SPIN_FRICTION)));
  // A hard throw would otherwise spin faster than the screen can show (it reads as a flicker).
  if (m.spin.lengthSq() > MAX_SPIN * MAX_SPIN) m.spin.setLength(MAX_SPIN);
  const w = m.spin.length();
  if (w > 1e-4) {
    dq.setFromAxisAngle(tmpAxis.copy(m.spin).divideScalar(w), w * dt);
    m.q.premultiply(dq).normalize();
  }

  // Nearly still on the felt: tip over onto the rolled face.
  nearestRest(face, m.q, rest);
  if (inHand || m.hop > 0 || speed > SETTLE_SPEED * 3) m.settling = false;
  else if (w < SETTLE_SPIN && speed < SETTLE_SPEED) m.settling = true;
  if (m.settling) {
    delta.copy(rest).multiply(tmpQ.copy(m.q).invert());
    if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
    const angle = 2 * Math.acos(Math.min(1, delta.w));
    const s = Math.sqrt(Math.max(1e-9, 1 - delta.w * delta.w));
    pull.set(delta.x / s, delta.y / s, delta.z / s).multiplyScalar(angle * TIP_PULL);
    m.spin.addScaledVector(pull, dt).multiplyScalar(Math.exp(-dt * TIP_DAMP));
    if (angle < 0.003 && m.spin.lengthSq() < 0.01) { m.q.copy(rest); m.spin.set(0, 0, 0); }
  }
  // Stand on the lowest corner: lying flat = 0; balanced on an edge = taller.
  const lift = inHand ? 0 : Math.max(0, lowest(hull, m.q) - lowest(hull, rest));
  return m.hop + lift;
}
