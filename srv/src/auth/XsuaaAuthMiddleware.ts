/**
 * N-CoreShift – XSUAA JWT Authentication Middleware (Production)
 *
 * Validates SAP XSUAA JWTs and maps scopes to N-CoreShift roles.
 * Uses the same ServerUser shape as DevAuthMiddleware so all downstream
 * handlers are auth-adapter-agnostic.
 *
 * The middleware selects itself automatically when NODE_ENV=production
 * or VCAP_APPLICATION is present. DevAuthMiddleware handles all other cases.
 *
 * JWT scope format: <xsappname>.<RoleName>
 * e.g.  ncoreshift!t1234.PlatformAdmin
 */

import type { Request, Response, NextFunction } from 'express';
import { ALL_NCS_ROLES, NCSRole, resolveServerPermissions } from './types.js';

// ── XSUAA JWT payload shape (relevant fields only) ────────────────────────────

interface XsuaaJwtPayload {
  /** Subject (user ID) */
  sub?: string;
  /** Display name */
  given_name?: string;
  family_name?: string;
  email?: string;
  /** XSUAA tenant identifier */
  zid?: string;
  /** XSUAA scopes granted to this token */
  scope?: string[];
  /** Client credentials subject */
  client_id?: string;
  /** External attributes (contains tenant info) */
  ext_attr?: {
    enhancer?: string;
    subaccountid?: string;
    zdn?: string;
  };
  /** Custom tenant attributes set in xs-security.json */
  'xs.user.attributes'?: {
    tenantId?: string[];
  };
  iat?: number;
  exp?: number;
  iss?: string;
}

// ── Scope → NCSRole mapping ───────────────────────────────────────────────────

/**
 * Maps an XSUAA scope string to an NCSRole.
 * XSUAA scopes are prefixed with the xsappname, e.g. "ncoreshift!t1234.PlatformAdmin"
 * We strip the prefix and match against NCS_ROLE values.
 */
function scopeToRole(scope: string): NCSRole | null {
  // Strip xsappname prefix (everything before and including the first dot after '!')
  const dotIdx = scope.lastIndexOf('.');
  if (dotIdx < 0) return null;
  const rolePart = scope.substring(dotIdx + 1);
  const candidate = `NCoreShift.${rolePart}` as NCSRole;
  return (ALL_NCS_ROLES as readonly string[]).includes(candidate) ? candidate : null;
}

function extractRoles(scopes: string[]): NCSRole[] {
  const roles: NCSRole[] = [];
  for (const scope of scopes) {
    const role = scopeToRole(scope);
    if (role && !roles.includes(role)) roles.push(role);
  }
  return roles;
}

// ── JWT decode (no verification – verification done by passport-jwt / @sap/xssec) ──

/**
 * Decode the base64url JWT payload WITHOUT signature verification.
 * Signature verification MUST be done by @sap/xssec or passport-jwt upstream.
 * This function is for extracting claims from an already-verified token.
 */
function decodeJwtPayload(token: string): XsuaaJwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(decoded) as XsuaaJwtPayload;
  } catch {
    return null;
  }
}

// ── Token cache (lightweight, in-process) ────────────────────────────────────

interface CachedToken {
  userId: string;
  tenantId: string;
  roles: NCSRole[];
  expiresAt: number;
}

const TOKEN_CACHE = new Map<string, CachedToken>();
const CACHE_TTL_BUFFER_SEC = 60; // evict 60 s before actual expiry

function evictExpiredTokens(): void {
  const now = Date.now() / 1000;
  for (const [key, entry] of TOKEN_CACHE) {
    if (entry.expiresAt <= now) TOKEN_CACHE.delete(key);
  }
}

// ── Middleware factory ────────────────────────────────────────────────────────

/**
 * XSUAA JWT middleware.
 *
 * In production this requires a valid JWT Bearer token.
 * Returns HTTP 401 for missing/invalid tokens and 403 for insufficient scopes.
 *
 * Usage:
 *   import { xsuaaAuthMiddleware } from './auth/XsuaaAuthMiddleware.js';
 *   app.use(xsuaaAuthMiddleware());
 */
export function xsuaaAuthMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Unauthorized',
        detail: 'Missing or malformed Authorization header. Expected: Bearer <token>',
      });
      return;
    }

    const token = authHeader.substring(7);

    // Serve from cache if available
    const cached = TOKEN_CACHE.get(token);
    if (cached && cached.expiresAt > Date.now() / 1000) {
      req.ncsUser = {
        id: cached.userId,
        name: cached.userId,
        tenantId: cached.tenantId,
        roles: cached.roles,
        permissions: resolveServerPermissions(cached.roles),
        isDevAuth: false,
      };
      next();
      return;
    }

    // Decode JWT payload (signature already verified by API Gateway / @sap/xssec)
    const payload = decodeJwtPayload(token);
    if (!payload) {
      res.status(401).json({ error: 'Unauthorized', detail: 'Invalid JWT format' });
      return;
    }

    // Expiry check
    const now = Date.now() / 1000;
    if (payload.exp && payload.exp < now) {
      res.status(401).json({ error: 'Unauthorized', detail: 'Token expired' });
      return;
    }

    // Extract identity
    const userId =
      payload.email ??
      payload.sub ??
      payload.client_id ??
      'unknown';

    const tenantId =
      payload['xs.user.attributes']?.tenantId?.[0] ??
      payload.ext_attr?.subaccountid ??
      payload.zid ??
      'unknown';

    const roles = extractRoles(payload.scope ?? []);

    // Require at least one recognised NCS role
    if (roles.length === 0) {
      res.status(403).json({
        error: 'Forbidden',
        detail: 'Token contains no N-CoreShift role assignments. ' +
          'Assign at least one NCoreShift role collection in BTP.',
      });
      return;
    }

    // Cache for remainder of token lifetime
    if (payload.exp) {
      evictExpiredTokens();
      TOKEN_CACHE.set(token, {
        userId,
        tenantId,
        roles,
        expiresAt: payload.exp - CACHE_TTL_BUFFER_SEC,
      });
    }

    req.ncsUser = {
      id: userId,
      name: payload.given_name
        ? `${payload.given_name} ${payload.family_name ?? ''}`.trim()
        : userId,
      tenantId,
      roles,
      permissions: resolveServerPermissions(roles),
      isDevAuth: false,
    };

    next();
  };
}

/**
 * Selects the correct auth middleware based on runtime environment.
 * Import this in server.ts instead of importing either middleware directly.
 *
 * In development/test: delegates to devAuthMiddleware (lazy import to avoid
 * DevAuthMiddleware being bundled into the production image).
 * In production / CF: uses xsuaaAuthMiddleware.
 */
export async function createAuthMiddleware(): Promise<
  (req: Request, res: Response, next: NextFunction) => void
> {
  if (process.env.NODE_ENV === 'production' || process.env.VCAP_APPLICATION) {
    return xsuaaAuthMiddleware();
  }
  const { devAuthMiddleware } = await import('./DevAuthMiddleware.js');
  return devAuthMiddleware;
}

/** Expose for testing */
export { decodeJwtPayload, extractRoles, scopeToRole };
