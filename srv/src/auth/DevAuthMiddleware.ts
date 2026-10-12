/**
 * N-CoreShift – Development auth middleware (Phase 1)
 *
 * Reads identity from HTTP request headers set by the DevAuthAdapter in the
 * frontend (or from a tool/curl request in development).
 *
 * NEVER use this middleware in production. The environment guard below
 * enforces that, but the production XSUAA adapter will replace this entirely.
 *
 * Header contract (mirrors DevAuthAdapter in app/src/auth/DevAuthAdapter.ts):
 *   x-dev-user-id      – user identifier
 *   x-dev-user-name    – display name
 *   x-dev-tenant-id    – tenant scope
 *   x-dev-roles        – comma-separated list of NCSRole values
 */

import type { Request, Response, NextFunction } from 'express';
import {
  ALL_NCS_ROLES,
  NCSRole,
  ServerUser,
  resolveServerPermissions,
} from './types';

// Default dev identity used when no headers are present.
const DEV_FALLBACK_USER: Omit<ServerUser, 'permissions'> = {
  id: 'dev-user@ncoreshift.local',
  name: 'Dev User',
  tenantId: 'dev-tenant',
  roles: ['NCoreShift.PlatformAdmin'],
  isDevAuth: true,
};

function parseRoles(raw: string | undefined): NCSRole[] {
  if (!raw) return DEV_FALLBACK_USER.roles;
  const parsed = raw
    .split(',')
    .map((r) => r.trim())
    .filter((r): r is NCSRole => (ALL_NCS_ROLES as readonly string[]).includes(r));
  // If every supplied role token was invalid, fall back to the default identity.
  return parsed.length > 0 ? parsed : DEV_FALLBACK_USER.roles;
}

/**
 * Express middleware that attaches a `ncsUser` object to every request.
 *
 * Usage (CAP cds.server / Express):
 *   app.use(devAuthMiddleware);
 *
 * Throws at startup if NODE_ENV === 'production'.
 */
export function devAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'DevAuthMiddleware must not be used in production. ' +
        'Configure the XSUAA auth adapter instead.',
    );
  }

  const id = (req.headers['x-dev-user-id'] as string | undefined) ?? DEV_FALLBACK_USER.id;
  const name = (req.headers['x-dev-user-name'] as string | undefined) ?? DEV_FALLBACK_USER.name;
  const tenantId =
    (req.headers['x-dev-tenant-id'] as string | undefined) ?? DEV_FALLBACK_USER.tenantId;
  const roles = parseRoles(req.headers['x-dev-roles'] as string | undefined);

  req.ncsUser = {
    id,
    name,
    tenantId,
    roles,
    permissions: resolveServerPermissions(roles),
    isDevAuth: true,
  };

  next();
}

/**
 * Express middleware that rejects requests whose resolved permissions do not
 * include the required permission.  Returns HTTP 403.
 *
 * Use after devAuthMiddleware (or the production auth middleware) has run.
 */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.ncsUser;
    if (!user) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }
    if (!user.permissions.has(permission as never)) {
      res.status(403).json({ error: 'Forbidden', requiredPermission: permission });
      return;
    }
    next();
  };
}
