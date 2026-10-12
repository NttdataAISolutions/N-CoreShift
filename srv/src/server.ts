/**
 * N-CoreShift – Express API server (Phase 3+)
 *
 * Starts a standalone Express application that serves the AI-Admin REST API
 * and (in future phases) additional service endpoints.
 *
 * Run:  npm run api            (from the srv/ directory)
 *       node_modules/.bin/ts-node -P tsconfig.json src/server.ts
 */

import path from 'path';
import dotenv from 'dotenv';

// Load .env from the monorepo root (two levels above srv/src/)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import express from 'express';
import { AiAdminRegistry } from './ai-admin/registry';
import { SapAiCoreAdapter, SapAiInterfaceAdapter, OpenAIAdapter } from './ai-admin/adapters';
import { createAiAdminRouter } from './ai-admin/router';

// ── Bootstrap the AI provider registry ────────────────────────────────────

const registry = new AiAdminRegistry();
registry.register(new SapAiCoreAdapter());
registry.register(new SapAiInterfaceAdapter());
registry.register(new OpenAIAdapter());

// Seed the active provider from env (default: sap-ai-interface)
const envActive = (process.env['AI_PROVIDER'] ?? 'sap-ai-interface') as
  | 'sap-ai-core'
  | 'sap-ai-interface'
  | 'openai';
registry.setInitialActive(envActive);

// ── Express app ────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// CORS – allow the Vite dev server (port 5173) and any configured origin
app.use((_req, res, next) => {
  const origin = _req.headers['origin'];
  const allowed = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-User');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'n-coreshift-api',
    activeProvider: registry.getActive(),
    ts: new Date().toISOString(),
  });
});

// ── AI Admin routes ────────────────────────────────────────────────────────
app.use('/api/ai-admin', createAiAdminRouter(registry));

// ── 404 catch-all ─────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env['PORT'] ?? '4005', 10);

app.listen(PORT, () => {
  /* eslint-disable no-console */
  console.log(`✅  N-CoreShift API server listening on http://localhost:${PORT}`);
  console.log(`   Active AI provider : ${registry.getActive() ?? 'none'}`);
  console.log(`   Health check       : http://localhost:${PORT}/health`);
  console.log(`   AI Admin API       : http://localhost:${PORT}/api/ai-admin/providers`);
  /* eslint-enable no-console */
});

export default app;
