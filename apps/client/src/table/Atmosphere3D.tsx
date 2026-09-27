// Weather over the table — fog, desert dust, rain, snow or embers. Built to stay cheap on school
// laptops and phones: no image files, one Points draw call whose motion runs entirely in the
// vertex shader (the CPU only advances a time uniform), fewer particles on small/touch screens,
// and plain three.js fog for the haze.
import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { TABLE_HALF_D, TABLE_HALF_W, parseAtmosphere, type AtmosphereKind } from '@kitforge/shared-types';

interface Look {
  /** Particles at full strength (desktop). 0 = haze only. */
  count: number;
  color: string;
  /** Fog color, or null for none. Near/far shrink as strength rises. */
  fog: string | null;
  fogFar: number;
  /** Units per second along y (negative = falling). */
  speed: number;
  /** Sideways sway in units. */
  sway: number;
  size: number;
  /** 0 round dot, 1 thin vertical streak, 2 glowing ember. */
  shape: number;
}

const LOOKS: Record<Exclude<AtmosphereKind, 'none'>, Look> = {
  fog: { count: 0, color: '#ffffff', fog: '#8a96a3', fogFar: 70, speed: 0, sway: 0, size: 0, shape: 0 },
  dust: { count: 900, color: '#e3c28a', fog: '#b08a55', fogFar: 80, speed: -0.25, sway: 2.2, size: 9, shape: 0 },
  rain: { count: 1400, color: '#a9c4e0', fog: '#3c4652', fogFar: 110, speed: -26, sway: 0.4, size: 28, shape: 1 },
  snow: { count: 1000, color: '#ffffff', fog: '#9fb0c2', fogFar: 110, speed: -1.6, sway: 1.2, size: 11, shape: 0 },
  embers: { count: 700, color: '#ff8a3d', fog: null, fogFar: 0, speed: 1.4, sway: 0.9, size: 15, shape: 2 },
};

/** Phones and tablets get fewer particles — the effect reads the same on a small screen. */
const lowPower = () => window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 800;

/** The box particles live in: a little bigger than the table, and tall enough to fall through. */
const BOX = { x: TABLE_HALF_W * 2 + 12, y: 22, z: TABLE_HALF_D * 2 + 12 };

const vertex = /* glsl */ `
  uniform float uTime, uSpeed, uSway, uSize, uHeight, uPixelRatio;
  attribute float aSeed;
  varying float vFade, vSeed;
  void main() {
    vec3 p = position;
    // Fall (or rise) and wrap, each particle offset by its own seed so they never line up.
    p.y = mod(p.y + uTime * uSpeed * (0.7 + aSeed * 0.6), uHeight);
    p.x += sin(uTime * 0.7 + aSeed * 40.0) * uSway;
    p.z += cos(uTime * 0.5 + aSeed * 23.0) * uSway;
    vFade = smoothstep(0.0, 2.0, p.y) * smoothstep(uHeight, uHeight - 3.0, p.y);
    vSeed = aSeed;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    // Capped so a flake drifting past the lens never becomes a giant blur (costly on phones too).
    gl_PointSize = min(uSize * uPixelRatio * (0.6 + aSeed * 0.8) * (20.0 / -mv.z), 26.0 * uPixelRatio);
  }`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity, uTime;
  uniform int uShape;
  varying float vFade, vSeed;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a;
    if (uShape == 1) a = smoothstep(0.06, 0.0, abs(c.x)) * smoothstep(0.5, 0.2, abs(c.y));   // rain streak
    else a = smoothstep(0.5, 0.1, length(c));                                                 // soft dot
    vec3 col = uColor;
    if (uShape == 2) { a *= 0.6 + 0.4 * sin(uTime * 6.0 + vSeed * 50.0); col = mix(uColor, vec3(1.0, 0.9, 0.5), smoothstep(0.3, 0.0, length(c))); }
    a *= vFade * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }`;

export function Atmosphere3D({ json }: { json: string }) {
  const atmo = useMemo(() => parseAtmosphere(json), [json]);
  const scene = useThree(s => s.scene);
  const look = atmo.kind === 'none' ? null : LOOKS[atmo.kind];

  // Haze: plain linear fog. The backdrop's shader ignores fog, so the sky stays visible behind it.
  useEffect(() => {
    if (!look?.fog) { scene.fog = null; return; }
    // Kept past the table at full strength so pieces stay readable — it's mood, not a blackout.
    const far = look.fogFar - atmo.strength * (look.fogFar * 0.5);
    scene.fog = new THREE.Fog(look.fog, 16, Math.max(40, far));
    return () => { scene.fog = null; };
  }, [look, atmo.strength, scene]);

  const count = look ? Math.round(look.count * atmo.strength * (lowPower() ? 0.45 : 1)) : 0;

  const geometry = useMemo(() => {
    if (!count) return null;
    const pos = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * BOX.x;
      pos[i * 3 + 1] = Math.random() * BOX.y;
      pos[i * 3 + 2] = (Math.random() - 0.5) * BOX.z;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, BOX.y / 2, 0), Math.hypot(BOX.x, BOX.y, BOX.z) / 2);
    return g;
  }, [count]);

  const material = useMemo(() => look && new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    blending: look.shape === 2 ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 }, uSpeed: { value: look.speed }, uSway: { value: look.sway }, uSize: { value: look.size },
      uHeight: { value: BOX.y }, uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uColor: { value: new THREE.Color(look.color) }, uOpacity: { value: 0.35 + atmo.strength * 0.5 }, uShape: { value: look.shape },
    },
  }), [look, atmo.strength]);

  useEffect(() => () => { geometry?.dispose(); }, [geometry]);
  useEffect(() => () => { material?.dispose(); }, [material]);

  useFrame((_, dt) => { if (material) material.uniforms.uTime.value += Math.min(dt, 0.1); });

  if (!geometry || !material) return null;
  return <points geometry={geometry} material={material} renderOrder={5} />;
}
