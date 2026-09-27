// Limits for moving pictures on pieces (animated GIFs and WebM/MP4 loops), and the student-facing
// explanation for each way a file can break them. Shared so the browser can explain a problem
// before uploading, and the server re-checks what it can (size, dimensions).
import type { ModelProblem } from './models.ts';

export const MEDIA_LIMITS = {
  /** GIFs: file size, frames, total loop length, largest side. */
  gifMaxMB: 8, gifMaxFrames: 300, gifMaxSeconds: 20, gifMaxPx: 1024,
  /** Clips: file size, loop length, largest side. */
  videoMaxMB: 10, videoMaxSeconds: 10, videoMaxPx: 1280,
};

const L = MEDIA_LIMITS;
const GIF_TOOLS = 'Free fix: ezgif.com → Resize / Optimize / Cut, then save and try again.';
const CLIP_TOOLS = 'Free fix: in any editor (or ezgif.com → Video to…), trim it, export 720p or smaller, then try again.';

export const mediaProblems = {
  gifTooBig: (mb: number): ModelProblem => ({ error: `This GIF is ${mb.toFixed(1)} MB — the limit is ${L.gifMaxMB} MB.`, fix: `Big GIFs are slow for everyone at the table. Make it smaller (fewer frames, fewer colors, or smaller size). ${GIF_TOOLS}` }),
  gifTooManyFrames: (n: number): ModelProblem => ({ error: `This GIF has ${n} frames — the limit is ${L.gifMaxFrames}.`, fix: `Cut it down to a short loop or drop every other frame. ${GIF_TOOLS}` }),
  gifTooLong: (s: number): ModelProblem => ({ error: `This GIF runs ${s.toFixed(1)} seconds — the limit is ${L.gifMaxSeconds}.`, fix: `Pieces work best with a short loop. ${GIF_TOOLS}` }),
  gifTooLarge: (px: number): ModelProblem => ({ error: `This GIF is ${px} px wide/tall — the limit is ${L.gifMaxPx} px.`, fix: `A piece is only a few inches on the table; 512 px is plenty. ${GIF_TOOLS}` }),
  clipTooBig: (mb: number): ModelProblem => ({ error: `This clip is ${mb.toFixed(1)} MB — the limit is ${L.videoMaxMB} MB.`, fix: `Every player downloads it. Trim it to a few seconds and export at 720p or smaller. ${CLIP_TOOLS}` }),
  clipTooLong: (s: number): ModelProblem => ({ error: `This clip is ${s.toFixed(1)} seconds — the limit is ${L.videoMaxSeconds}.`, fix: `Pieces loop their clip forever, so a short loop is all you need. ${CLIP_TOOLS}` }),
  clipTooLarge: (px: number): ModelProblem => ({ error: `This clip is ${px} px wide/tall — the limit is ${L.videoMaxPx} px.`, fix: `Export at 720p (1280 × 720) or smaller. ${CLIP_TOOLS}` }),
  clipUnplayable: (): ModelProblem => ({ error: 'This clip can’t be played in the browser.', fix: 'Use WebM (VP9 — keeps transparency) or MP4 (H.264). From most editors: Export → WebM, or MP4 with the H.264 codec. Note: iPhones can’t show transparent WebM; they show the clip without transparency or not at all.' }),
  gifUnreadable: (): ModelProblem => ({ error: 'That GIF couldn’t be read.', fix: `It may be damaged. Re-save it (${GIF_TOOLS.replace('Free fix: ', '')})` }),
  wrongType: (name: string): ModelProblem => ({ error: `“${name}” isn’t a picture or clip the table can use.`, fix: 'Use PNG, JPG, WebP or GIF images, or WebM/MP4 clips (up to 10 seconds). For 3D models use 🧊 Add 3D model.' }),
};
