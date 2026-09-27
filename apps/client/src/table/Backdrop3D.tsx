// Everything behind the table: a big inside-out sphere that follows the camera, painted by one
// shader — solid, gradient, star field, nebula or an uploaded image — with an optional animated
// wave or kaleidoscope effect. Driven by view direction, so it turns naturally as you orbit.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { parseBackdrop, type BackdropMode } from '@kitforge/shared-types';
import { assetUrl } from '../config.ts';

const MODE_ID: Record<BackdropMode, number> = { solid: 0, gradient: 1, space: 2, nebula: 3, image: 4 };
const EFFECT_ID = { none: 0, wave: 1, kaleido: 2 } as const;

const vertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragment = /* glsl */ `
  uniform int uMode, uEffect;
  uniform vec3 uC0, uC1, uC2;
  uniform sampler2D uImage;
  uniform bool uHasImage;
  uniform float uTime;
  varying vec3 vDir;
  #define PI 3.14159265

  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; } return v; }
  float stars(vec3 d, float density) {
    vec3 p = d * 180.0; vec3 id = floor(p);
    float h = hash(id);
    float s = step(1.0 - density, h) * smoothstep(0.5, 0.0, length(fract(p) - 0.5));
    return s * (0.5 + 0.5 * sin(uTime * 2.0 + h * 40.0));
  }

  void main() {
    vec3 d = normalize(vDir);
    // Longitude/latitude, bent by the chosen effect before anything is painted.
    float lon = atan(d.z, d.x), lat = asin(clamp(d.y, -1.0, 1.0));
    if (uEffect == 1) {
      lon += sin(lat * 6.0 + uTime * 0.8) * 0.18;
      lat += sin(lon * 5.0 + uTime * 0.6) * 0.07;
    } else if (uEffect == 2) {
      float seg = PI / 4.0;
      lon = abs(mod(lon + uTime * 0.05, seg) - seg * 0.5);
      lat = abs(lat);
    }
    vec3 dir = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
    float up = lat / PI + 0.5;
    vec3 col = uC0;

    if (uMode == 1) {
      col = up > 0.5 ? mix(uC1, uC0, (up - 0.5) * 2.0) : mix(uC2, uC1, up * 2.0);
    } else if (uMode == 2 || uMode == 3) {
      float drift = uTime * 0.01;
      float n = fbm(dir * 2.2 + drift);
      float n2 = fbm(dir * 4.0 - drift + n);
      float cloud = uMode == 3 ? smoothstep(0.35, 0.85, n2) : smoothstep(0.55, 0.95, n2) * 0.35;
      col = mix(uC0, uC1, cloud);
      col = mix(col, uC2, pow(cloud, 3.0) * (uMode == 3 ? 0.9 : 0.5));
      col += vec3(stars(dir, uMode == 2 ? 0.035 : 0.015));
    } else if (uMode == 4 && uHasImage) {
      col = texture2D(uImage, vec2(lon / (2.0 * PI) + 0.5, up)).rgb;
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

export function Backdrop3D({ json }: { json: string }) {
  const b = useMemo(() => parseBackdrop(json), [json]);
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uMode: { value: 0 }, uEffect: { value: 0 }, uTime: { value: 0 },
      uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() },
      uImage: { value: null }, uHasImage: { value: false },
    },
  }), []);

  useEffect(() => {
    const u = material.uniforms;
    u.uMode.value = MODE_ID[b.mode];
    u.uEffect.value = EFFECT_ID[b.effect];
    const [c0, c1 = c0, c2 = c1] = b.colors;
    u.uC0.value.set(c0); u.uC1.value.set(c1); u.uC2.value.set(c2);
    if (b.mode !== 'image' || !b.image) { u.uHasImage.value = false; return; }
    let live = true;
    new THREE.TextureLoader().loadAsync(assetUrl(b.image)).then(tex => {
      if (!live) { tex.dispose(); return; }
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      (u.uImage.value as THREE.Texture | null)?.dispose();
      u.uImage.value = tex; u.uHasImage.value = true;
    }).catch(() => { u.uHasImage.value = false; });
    return () => { live = false; };
  }, [b, material]);

  useEffect(() => () => { (material.uniforms.uImage.value as THREE.Texture | null)?.dispose(); material.dispose(); }, [material]);

  useFrame(({ camera, clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    mesh.current?.position.copy(camera.position);
  });

  return (
    <mesh ref={mesh} material={material} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[100, 48, 32]} />
    </mesh>
  );
}
