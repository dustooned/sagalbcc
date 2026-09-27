// HTTP side: tester password -> session token, and image uploads/serving. Room traffic goes
// over Colyseus websockets instead.
import fs from 'node:fs';
import path from 'node:path';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import { MODEL_LIMITS, modelProblems, type AuthResponse, type UploadResponse } from '@kitforge/shared-types';
import { RateLimiter, issueToken, passwordMatches, verifyToken } from '../auth.ts';
import type { Services } from '../services.ts';
import { MIME, isGlb, sniffImageType } from '../storage/AssetStorage.ts';
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
      const type = sniffImageType(body);
      if (!type) { res.status(415).json({ error: 'Only PNG, JPG or WebP images — or a .glb 3D model — can be imported.' }); return; }
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
