// HTTP side: tester password -> session token, and image uploads/serving. Room traffic goes
// over Colyseus websockets instead.
import fs from 'node:fs';
import path from 'node:path';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import { MEDIA_LIMITS, MODEL_LIMITS, mediaProblems, modelProblems, type AuthResponse, type UploadResponse } from '@kitforge/shared-types';
import { RateLimiter, issueToken, passwordMatches, verifyToken } from '../auth.ts';
import type { Services } from '../services.ts';
import { MIME, isGlb, sniffImageType, sniffVideoType } from '../storage/AssetStorage.ts';
import { checkGlb } from '../storage/glbCheck.ts';

const ip = (req: Request) => req.ip || req.socket.remoteAddress || 'unknown';

export function installRoutes(app: Application, { config, storage }: Services) {
  // Behind a hosting proxy every request would otherwise share the proxy's IP (and its limits).
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  const authLimit = new RateLimiter(10, 5 * 60_000);
  // One kit load uploads every unique card/piece/board image; a big deck easily tops 60.
  const uploadLimit = new RateLimiter(400, 60_000);

  // Token auth (no cookies), so a permissive CORS policy doesn't expose anything. It lets the
  // Vite dev client on another port call the API and load images into WebGL textures.
  app.use(['/api', '/uploads'], (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  const requireToken = (req: Request, res: Response, next: NextFunction) => {
    const token = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (verifyToken(token, config.sessionSecret)) return next();
    res.status(401).json({ error: 'Tester session missing or expired.' });
  };

  app.get('/api/health', (_req, res) => { res.json({ ok: true, open: config.open }); });

  app.post('/api/auth', express.json({ limit: '4kb' }), (req, res) => {
    if (!authLimit.allow(ip(req))) { res.status(429).json({ error: 'Too many attempts. Wait a few minutes.' }); return; }
    if (!config.open && !passwordMatches(req.body?.password, config.password)) { res.status(401).json({ error: 'Wrong password.' }); return; }
    res.json(issueToken(config.sessionSecret, config.sessionHours) satisfies AuthResponse);
  });

  app.post('/api/upload', requireToken,
    (req, res, next) => { if (uploadLimit.allow(ip(req))) return next(); res.status(429).json({ error: 'Too many uploads. Slow down a little.' }); },
    // Models may be bigger than images; the per-type limit is enforced after identifying the file.
    express.raw({ type: () => true, limit: Math.max(config.maxUploadBytes, MODEL_LIMITS.maxMB * 1024 * 1024) }),
    async (req, res) => {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (isGlb(body)) {
        const problem = checkGlb(body);
        if (problem) { res.status(422).json(problem); return; }
        const saved = await storage.save(body, { type: 'glb' });
        res.status(201).json({ assetUrl: `/uploads/${saved.id}` } satisfies UploadResponse);
        return;
      }
      const video = sniffVideoType(body);
      if (video) {
        if (body.length > MEDIA_LIMITS.videoMaxMB * 1024 * 1024) { res.status(413).json(mediaProblems.clipTooBig(body.length / 1024 / 1024)); return; }
        const saved = await storage.save(body, { type: video });
        res.status(201).json({ assetUrl: `/uploads/${saved.id}` } satisfies UploadResponse);
        return;
      }
      const type = sniffImageType(body);
      if (!type) { res.status(415).json({ error: 'Only PNG, JPG, WebP or GIF images, WebM/MP4 clips, or a .glb 3D model can be imported.' }); return; }
      if (type === 'gif') {
        const mb = body.length / 1024 / 1024, side = Math.max(body.readUInt16LE(6), body.readUInt16LE(8));
        if (mb > MEDIA_LIMITS.gifMaxMB) { res.status(413).json(mediaProblems.gifTooBig(mb)); return; }
        if (side > MEDIA_LIMITS.gifMaxPx) { res.status(422).json(mediaProblems.gifTooLarge(side)); return; }
      }
      if (body.length > config.maxUploadBytes) { res.status(413).json({ error: `Images can be up to ${config.maxUploadBytes / 1024 / 1024} MB.` }); return; }
      const saved = await storage.save(body, { type });
      res.status(201).json({ assetUrl: `/uploads/${saved.id}` } satisfies UploadResponse);
    });

  // Uploaded images: opaque random ids, served with their sniffed type only. Namespaced under
  // /uploads (not /assets) so it can't shadow the built client's own /assets/*.js and *.css.
  app.get('/uploads/:id', async (req, res) => {
    const asset = await storage.get(String(req.params.id));
    if (!asset?.data) { res.sendStatus(404); return; }
    res.setHeader('Content-Type', MIME[asset.type]);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('Accept-Ranges', 'bytes');
    // Safari won't play a video without byte-range support.
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range) {
      const size = asset.data.length;
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
      if (start >= size || start > end) { res.setHeader('Content-Range', `bytes */${size}`); res.sendStatus(416); return; }
      res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.send(asset.data.subarray(start, end + 1));
      return;
    }
    res.send(asset.data);
  });

  // Production: the built client is served from the same origin as the API and websockets.
  if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist, { index: 'index.html' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || !req.accepts('html')) return next();
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  }

  app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    if (err.type === 'entity.too.large') {
      res.status(413).json({ error: `That file is too large (images up to ${config.maxUploadBytes / 1024 / 1024} MB, 3D models up to ${MODEL_LIMITS.maxMB} MB).`, fix: modelProblems.tooBig(MODEL_LIMITS.maxMB).fix });
      return;
    }
    res.status(status).json({ error: status >= 500 ? 'Server error.' : err.message });
  });
}
