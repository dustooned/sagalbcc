// Everything behind the table, painted by one shader on a big inside-out sphere that follows the
// camera: solid, gradient, star field, nebula or an uploaded image, with an optional animated
// wave or kaleidoscope effect.
//
// The table camera looks down at 18–89°, so it only ever sees the lower part of the sky. Space
// and nebula are the same in every direction, so they stay truly 3D and turn as you orbit. A
// gradient or an ordinary picture painted onto the sphere would only ever show its bottom edge,
// so those fill the screen behind the table instead (like a desktop wallpaper). A 2:1 panorama
// is a real 360° image and still wraps the whole sphere.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { parseBackdrop, type BackdropMode } from '@kitforge/shared-types';
import { assetUrl } from '../config.ts';
import { store } from '../net/tableStore.ts';

const MODE_ID: Record<BackdropMode, number> = { solid: 0, gradient: 1, space: 2, nebula: 3, image: 4 };
const EFFECT_ID = { none: 0, wave: 1, kaleido: 2 } as const;
/** Width ÷ height of a 360° panorama; anything close to it wraps the sphere. */
const isPanorama = (w: number, h: number) => Math.abs(w / h - 2) < 0.15;

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
  uniform bool uHasImage, uPanorama;
  uniform float uTime, uImageAspect;
  uniform vec2 uView;
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

  // Screen position 0–1, bent by the chosen effect.
  vec2 screenUv() {
    vec2 s = gl_FragCoord.xy / uView;
    float aspect = uView.x / uView.y;
    if (uEffect == 1) {
      s.x += sin(s.y * 9.0 + uTime * 0.8) * 0.025;
      s.y += sin(s.x * 7.0 + uTime * 0.6) * 0.025;
    } else if (uEffect == 2) {
      vec2 p = s - 0.5; p.x *= aspect;
      float r = length(p), seg = PI / 4.0;
      float a = abs(mod(atan(p.y, p.x) + uTime * 0.05, seg) - seg * 0.5);
      p = r * vec2(cos(a), sin(a)); p.x /= aspect;
      s = p + 0.5;
    }
    return s;
  }
  // Cover-fit the image to the screen, like a wallpaper: no stretching, trims the long side.
  vec2 coverUv(vec2 s) {
    float view = uView.x / uView.y;
    if (view > uImageAspect) s.y = (s.y - 0.5) * uImageAspect / view + 0.5;
    else s.x = (s.x - 0.5) * view / uImageAspect + 0.5;
    return s;
  }

  void main() {
    vec3 col = uC0;

    if (uMode == 1) {
      float up = screenUv().y;
      col = up > 0.5 ? mix(uC1, uC0, (up - 0.5) * 2.0) : mix(uC2, uC1, up * 2.0);
    } else if (uMode == 4 && uHasImage && !uPanorama) {
      col = texture2D(uImage, coverUv(screenUv())).rgb;
    } else if (uMode >= 2) {
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
      if (uMode == 4) {
        if (uHasImage) {
          vec2 uv = vec2(lon / (2.0 * PI) + 0.5, lat / PI + 0.5);
          // Longitude jumps from 1 back to 0 behind you; without this the GPU sees a huge
          // step there and draws a thin seam from its blurriest mip level.
          vec2 gx = dFdx(uv), gy = dFdy(uv);
          gx.x -= floor(gx.x + 0.5); gy.x -= floor(gy.x + 0.5);
          col = textureGrad(uImage, uv, gx, gy).rgb;
        }
      } else {
        float drift = uTime * 0.01;
        float n = fbm(dir * 2.2 + drift);
        float n2 = fbm(dir * 4.0 - drift + n);
        // Space: faint clouds so each preset still has its own color; nebula: full clouds.
        float cloud = uMode == 3 ? smoothstep(0.35, 0.85, n2) : smoothstep(0.45, 0.95, n2) * 0.6;
        col = mix(uC0, uC1, cloud);
        col = mix(col, uC2, pow(cloud, 3.0) * (uMode == 3 ? 0.9 : 0.7));
        col += vec3(stars(dir, uMode == 2 ? 0.035 : 0.015));
      }
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
      uImage: { value: null }, uHasImage: { value: false }, uPanorama: { value: false }, uImageAspect: { value: 1 },
      uView: { value: new THREE.Vector2(1, 1) },
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
      const { width = 1, height = 1 } = tex.image as { width?: number; height?: number };
      tex.colorSpace = THREE.SRGBColorSpace;
      const pano = isPanorama(width, height);
      // Panoramas wrap around; wallpapers mirror at their edges so the wave/kaleido effects
      // never pull in a hard border.
      tex.wrapS = pano ? THREE.RepeatWrapping : THREE.MirroredRepeatWrapping;
      tex.wrapT = pano ? THREE.ClampToEdgeWrapping : THREE.MirroredRepeatWrapping;
      (u.uImage.value as THREE.Texture | null)?.dispose();
      u.uImage.value = tex; u.uHasImage.value = true;
      u.uPanorama.value = pano; u.uImageAspect.value = width / height;
    }).catch(() => {
      if (!live) return;
      u.uHasImage.value = false;
      // Most often: the server restarted without saved uploads, so the file is gone.
      store.notify('The background image could not be loaded — pick it again under Table Look.');
    });
    return () => { live = false; };
  }, [b, material]);

  useEffect(() => () => { (material.uniforms.uImage.value as THREE.Texture | null)?.dispose(); material.dispose(); }, [material]);

  useFrame(({ camera, clock, gl }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    gl.getDrawingBufferSize(material.uniforms.uView.value as THREE.Vector2);
    mesh.current?.position.copy(camera.position);
  });

  return (
    <mesh ref={mesh} material={material} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[100, 48, 32]} />
    </mesh>
  );
}
