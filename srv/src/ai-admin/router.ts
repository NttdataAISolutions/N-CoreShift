/**
 * Express router for /api/ai-admin/*
 *
 * Routes:
 *   GET  /api/ai-admin/providers              – list all providers (info only)
 *   GET  /api/ai-admin/providers/:id/status   – live connectivity status for one provider
 *   POST /api/ai-admin/providers/:id/test     – on-demand connection test
 *   POST /api/ai-admin/active-provider        – set the active provider  { providerId: string }
 *   GET  /api/ai-admin/audit                  – audit log  ?limit=N
 */

import { Router, Request, Response } from 'express';
import { AiAdminRegistry } from './registry';
import { ProviderId } from './types';

export function createAiAdminRouter(registry: AiAdminRegistry): Router {
  const router = Router();

  // GET /api/ai-admin/providers
  router.get('/providers', (_req: Request, res: Response) => {
    res.json({ providers: registry.listProviders(), activeProvider: registry.getActive() });
  });

  // GET /api/ai-admin/providers/:id/status
  router.get('/providers/:id/status', async (req: Request, res: Response) => {
    const id = req.params['id'] as ProviderId;
    const status = await registry.getProviderStatus(id);
    if (!status) {
      res.status(404).json({ error: `Provider '${id}' not found` });
      return;
    }
    res.json(status);
  });

  // POST /api/ai-admin/providers/:id/test
  router.post('/providers/:id/test', async (req: Request, res: Response) => {
    const id = req.params['id'] as ProviderId;
    const actor = (req.headers['x-user'] as string) || 'api';
    const result = await registry.testConnection(id, actor);
    if (!result) {
      res.status(404).json({ error: `Provider '${id}' not found` });
      return;
    }
    res.json(result);
  });

  // POST /api/ai-admin/active-provider  body: { providerId: string }
  router.post('/active-provider', (req: Request, res: Response) => {
    const { providerId } = req.body as { providerId?: string };
    if (!providerId) {
      res.status(400).json({ error: 'Missing providerId in request body' });
      return;
    }
    const actor = (req.headers['x-user'] as string) || 'api';
    const ok = registry.setActiveProvider(providerId as ProviderId, actor);
    if (!ok) {
      res.status(404).json({ error: `Provider '${providerId}' not registered` });
      return;
    }
    res.json({ activeProvider: providerId, message: 'Active provider updated' });
  });

  // GET /api/ai-admin/audit?limit=50
  router.get('/audit', (req: Request, res: Response) => {
    const limit = Math.min(parseInt((req.query['limit'] as string) || '100', 10), 500);
    res.json({ entries: registry.getAuditLog(limit) });
  });

  return router;
}
