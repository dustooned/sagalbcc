// Moving pictures on pieces: animated GIFs and short WebM/MP4 loops, transparency included.
// GIFs are decoded once (gifuct-js) and replayed onto a canvas at their own frame timings;
// clips play as muted, looping video textures. One texture per file is shared by every copy of
// that piece, and everything is advanced from a single per-frame tick, so a table full of the
// same animated token costs the same as one.
import * as THREE from 'three';
import { decompressFrames, parseGIF, type ParsedFrame } from 'gifuct-js';

export const isGif = (url: string) => /\.gif$/i.test(url);
export const isVideo = (url: string) => /\.(webm|mp4)$/i.test(url);
export const isAnimated = (url: string) => isGif(url) || isVideo(url);

/** Biggest side a GIF canvas is drawn at — keeps huge GIFs cheap to upload every frame. */
const MAX_GIF_SIDE = 512;

interface GifPlayer {
  tex: THREE.CanvasTexture;
  frames: ParsedFrame[];
  full: HTMLCanvasElement;   // the GIF composited at its own size
  out: HTMLCanvasElement;    // what the texture shows (full, scaled down if large)
  patch: HTMLCanvasElement;  // one frame's rectangle, before compositing
  index: number;
  nextAt: number;
  restore: ImageData | null; // for "restore to previous" disposal
}
const gifs: GifPlayer[] = [];
const videos: HTMLVideoElement[] = [];

/** For debugging: which GIF frame each player is on, and whether each clip is playing. */
export const animationStats = () => ({ gifFrames: gifs.map(p => p.index), videosPlaying: videos.map(v => !v.paused), videoTimes: videos.map(v => +v.currentTime.toFixed(2)) });

function drawFrame(p: GifPlayer) {
  const f = p.frames[p.index];
  const g = p.full.getContext('2d')!;
  if (p.index === 0) g.clearRect(0, 0, p.full.width, p.full.height);
  if (f.disposalType === 3) p.restore = g.getImageData(0, 0, p.full.width, p.full.height);
  const { width, height, left, top } = f.dims;
  p.patch.width = width; p.patch.height = height;
  p.patch.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(f.patch), width, height), 0, 0);
  g.drawImage(p.patch, left, top);

  const o = p.out.getContext('2d')!;
  o.clearRect(0, 0, p.out.width, p.out.height);
  o.drawImage(p.full, 0, 0, p.out.width, p.out.height);
  p.tex.needsUpdate = true;

  // Prepare the canvas for the next frame the way this one asks.
  if (f.disposalType === 2) g.clearRect(left, top, width, height);
  else if (f.disposalType === 3 && p.restore) { g.putImageData(p.restore, 0, 0); p.restore = null; }
}

export function gifTexture(url: string, finish: (t: THREE.Texture) => THREE.Texture): THREE.Texture {
  const out = document.createElement('canvas');
  out.width = out.height = 2;
  const tex = finish(new THREE.CanvasTexture(out)) as THREE.CanvasTexture;
  fetch(url).then(r => r.arrayBuffer()).then(buf => {
    const gif = parseGIF(buf);
    const frames = decompressFrames(gif, true);
    if (!frames.length) return;
    const w = gif.lsd.width, h = gif.lsd.height;
    const scale = Math.min(1, MAX_GIF_SIDE / Math.max(w, h));
    const full = Object.assign(document.createElement('canvas'), { width: w, height: h });
    out.width = Math.max(1, Math.round(w * scale)); out.height = Math.max(1, Math.round(h * scale));
    const p: GifPlayer = { tex, frames, full, out, patch: document.createElement('canvas'), index: 0, nextAt: 0, restore: null };
    drawFrame(p);
    tex.dispose(); // canvas size changed; three re-uploads on next use
    p.nextAt = performance.now() + frameDelay(frames[0]);
    if (frames.length > 1) gifs.push(p);
  }).catch(() => { /* the piece keeps its blank face */ });
  return tex;
}

/** GIF delays of 0–10 ms are treated as 100 ms, like browsers do. */
const frameDelay = (f: ParsedFrame) => (f.delay > 10 ? f.delay : 100);

export function videoTexture(url: string, finish: (t: THREE.Texture) => THREE.Texture): THREE.Texture {
  const video = Object.assign(document.createElement('video'), {
    src: url, crossOrigin: 'anonymous', loop: true, muted: true, playsInline: true, autoplay: true, preload: 'auto',
  });
  video.setAttribute('playsinline', '');
  videos.push(video);
  const start = () => { void video.play().catch(() => { /* retried on the next tap below */ }); };
  video.addEventListener('canplay', start, { once: true });
  // Some phones only allow playback after the user has touched the page once.
  window.addEventListener('pointerdown', start, { once: true });
  return finish(new THREE.VideoTexture(video));
}

/** Called once per rendered frame: advances every GIF whose next frame is due. */
export function tickAnimatedTextures(now = performance.now()) {
  for (const p of gifs) {
    if (now < p.nextAt) continue;
    p.index = (p.index + 1) % p.frames.length;
    drawFrame(p);
    // If the tab was hidden for a while, don't try to catch up frame by frame.
    p.nextAt = Math.max(p.nextAt + frameDelay(p.frames[p.index]), now);
  }
}
