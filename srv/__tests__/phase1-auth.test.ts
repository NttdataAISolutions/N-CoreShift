/**
 * N-CoreShift – Phase 1 auth / RBAC tests
 *
 * Covers:
 *  - Role → permission resolution
 *  - Permission helpers (userCan, userHasRole)
 *  - DevAuthMiddleware: default identity, header parsing, role filtering
 *  - requirePermission: 401 when no user, 403 when lacking permission, next() when allowed
 *  - Production guard on DevAuthMiddleware
 *  - Tenant isolation primitives (tenantId scoping)
 */

import type { Request, Response, NextFunction } from 'express';
import {
  ALL_NCS_ROLES,
  ALL_NCS_PERMISSIONS,
  NCSRole,
  NCSPermission,
  ROLE_PERMISSIONS,
  ServerUser,
  resolveServerPermissions,
  userCan,
  userHasRole,
} from '../src/auth/types';
import { devAuthMiddleware, requirePermission } from '../src/auth/DevAuthMiddleware';

// ── Helper: build a minimal mock Express request ──────────────────────────────

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers, ncsUser: undefined } as unknown as Request;
}

function makeRes(): { status: jest.Mock; json: jest.Mock } & Partial<Response> {
  const res: { status: jest.Mock; json: jest.Mock } & Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res;
}

const next: NextFunction = jest.fn();

beforeEach(() => {
  (next as jest.Mock).mockClear();
  delete process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
});

// ── Role/permission constants ─────────────────────────────────────────────────

describe('RBAC constants', () => {
  it('exports exactly 7 roles', () => {
    expect(ALL_NCS_ROLES).toHaveLength(7);
  });

  it('exports 18 permissions', () => {
    expect(ALL_NCS_PERMISSIONS).toHaveLength(18);
  });

  it('every role has at least one permission', () => {
    for (const role of ALL_NCS_ROLES) {
      expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });

  it('PlatformAdmin holds all permissions', () => {
    const adminPerms = resolveServerPermissions(['NCoreShift.PlatformAdmin']);
    for (const p of ALL_NCS_PERMISSIONS) {
      expect(adminPerms.has(p)).toBe(true);
    }
  });

  it('NCoreShift.User does not hold admin:write', () => {
    const perms = resolveServerPermissions(['NCoreShift.User']);
    expect(perms.has('admin:write')).toBe(false);
  });

  it('CleanCoreApprover holds landscape:approve', () => {
    const perms = resolveServerPermissions(['NCoreShift.CleanCoreApprover']);
    expect(perms.has('landscape:approve')).toBe(true);
  });

  it('NCoreShift.User does NOT hold landscape:approve', () => {
    const perms = resolveServerPermissions(['NCoreShift.User']);
    expect(perms.has('landscape:approve')).toBe(false);
  });

  it('merges permissions from multiple roles', () => {
    const perms = resolveServerPermissions([
      'NCoreShift.User',
      'NCoreShift.CleanCoreApprover',
    ]);
    expect(perms.has('landscape:approve')).toBe(true);
    expect(perms.has('analysis:approve')).toBe(true);
    expect(perms.has('project:read')).toBe(true);
    // Still not admin:write
    expect(perms.has('admin:write')).toBe(false);
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

describe('userCan / userHasRole', () => {
  const makeUser = (roles: NCSRole[]): ServerUser => ({
    id: 'u1',
    name: 'Test',
    tenantId: 't1',
    roles,
    permissions: resolveServerPermissions(roles),
    isDevAuth: true,
  });

  it('userCan returns true when permission is present', () => {
    const user = makeUser(['NCoreShift.Consultant']);
    expect(userCan(user, 'analysis:create')).toBe(true);
  });

  it('userCan returns false when permission is absent', () => {
    const user = makeUser(['NCoreShift.User']);
    expect(userCan(user, 'artifact:generate')).toBe(false);
  });

  it('userHasRole returns true when role matches', () => {
    const user = makeUser(['NCoreShift.ProjectAdmin']);
    expect(userHasRole(user, ['NCoreShift.ProjectAdmin', 'NCoreShift.PlatformAdmin'])).toBe(true);
  });

  it('userHasRole returns false when no roles match', () => {
    const user = makeUser(['NCoreShift.User']);
    expect(userHasRole(user, ['NCoreShift.PlatformAdmin'])).toBe(false);
  });
});

// ── DevAuthMiddleware ─────────────────────────────────────────────────────────

describe('devAuthMiddleware', () => {
  it('attaches default dev user when no headers present', () => {
    const req = makeReq();
    devAuthMiddleware(req as Request, makeRes() as unknown as Response, next);
    expect(req.ncsUser).toBeDefined();
    expect(req.ncsUser!.id).toBe('dev-user@ncoreshift.local');
    expect(req.ncsUser!.isDevAuth).toBe(true);
    expect(req.ncsUser!.tenantId).toBe('dev-tenant');
    // Default role is PlatformAdmin
    expect(req.ncsUser!.roles).toContain('NCoreShift.PlatformAdmin');
    expect(next).toHaveBeenCalled();
  });

  it('reads user identity from headers', () => {
    const req = makeReq({
      'x-dev-user-id': 'alice@example.com',
      'x-dev-user-name': 'Alice',
      'x-dev-tenant-id': 'tenant-acme',
      'x-dev-roles': 'NCoreShift.Consultant',
    });
    devAuthMiddleware(req as Request, makeRes() as unknown as Response, next);
    expect(req.ncsUser!.id).toBe('alice@example.com');
    expect(req.ncsUser!.name).toBe('Alice');
    expect(req.ncsUser!.tenantId).toBe('tenant-acme');
    expect(req.ncsUser!.roles).toEqual(['NCoreShift.Consultant']);
  });

  it('resolves permissions from header roles', () => {
    const req = makeReq({ 'x-dev-roles': 'NCoreShift.Consultant' });
    devAuthMiddleware(req as Request, makeRes() as unknown as Response, next);
    expect(req.ncsUser!.permissions.has('analysis:create')).toBe(true);
    expect(req.ncsUser!.permissions.has('admin:write')).toBe(false);
  });

  it('ignores invalid roles in header', () => {
    const req = makeReq({ 'x-dev-roles': 'NCoreShift.Consultant,INVALID_ROLE,NCoreShift.User' });
    devAuthMiddleware(req as Request, makeRes() as unknown as Response, next);
    expect(req.ncsUser!.roles).toEqual(['NCoreShift.Consultant', 'NCoreShift.User']);
  });

  it('falls back to PlatformAdmin when header roles list is all invalid', () => {
    const req = makeReq({ 'x-dev-roles': 'NOT_A_ROLE' });
    devAuthMiddleware(req as Request, makeRes() as unknown as Response, next);
    // parseRoles returns empty array → falls back to DEV_FALLBACK_USER.roles
    expect(req.ncsUser!.roles).toContain('NCoreShift.PlatformAdmin');
  });

  it('throws if NODE_ENV is production', () => {
    process.env.NODE_ENV = 'production';
    const req = makeReq();
    expect(() =>
      devAuthMiddleware(req as Request, makeRes() as unknown as Response, next),
    ).toThrow('DevAuthMiddleware must not be used in production');
  });

  it('handles multiple valid roles in header', () => {
    const req = makeReq({
      'x-dev-roles': 'NCoreShift.User,NCoreShift.CleanCoreApprover',
    });
    devAuthMiddleware(req as Request, makeRes() as unknown as Response, next);
    expect(req.ncsUser!.roles).toContain('NCoreShift.User');
    expect(req.ncsUser!.roles).toContain('NCoreShift.CleanCoreApprover');
    expect(req.ncsUser!.permissions.has('landscape:approve')).toBe(true);
  });
});

// ── requirePermission ─────────────────────────────────────────────────────────

describe('requirePermission middleware', () => {
  function makeAuthedReq(roles: NCSRole[]): Request {
    const req = makeReq() as Request;
    req.ncsUser = {
      id: 'u1',
      name: 'Test',
      tenantId: 't1',
      roles,
      permissions: resolveServerPermissions(roles),
      isDevAuth: true,
    };
    return req;
  }

  it('calls next() when user has required permission', () => {
    const req = makeAuthedReq(['NCoreShift.Consultant']);
    const res = makeRes();
    requirePermission('analysis:create')(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 when user lacks required permission', () => {
    const req = makeAuthedReq(['NCoreShift.User']);
    const res = makeRes();
    requirePermission('artifact:generate')(req, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Forbidden' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when ncsUser is missing', () => {
    const req = makeReq() as Request;
    const res = makeRes();
    requirePermission('project:read')(req, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Unauthenticated' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('PlatformAdmin passes any permission check', () => {
    const req = makeAuthedReq(['NCoreShift.PlatformAdmin']);
    const res = makeRes();
    const perm = 'tenant:manage' as NCSPermission;
    requirePermission(perm)(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });
});

// ── Tenant isolation primitives ───────────────────────────────────────────────

describe('tenant isolation', () => {
  it('different headers produce different tenantIds', () => {
    const req1 = makeReq({ 'x-dev-tenant-id': 'tenant-a' });
    const req2 = makeReq({ 'x-dev-tenant-id': 'tenant-b' });
    const r = makeRes() as unknown as Response;
    devAuthMiddleware(req1 as Request, r, next);
    devAuthMiddleware(req2 as Request, r, next);
    expect(req1.ncsUser!.tenantId).toBe('tenant-a');
    expect(req2.ncsUser!.tenantId).toBe('tenant-b');
    expect(req1.ncsUser!.tenantId).not.toBe(req2.ncsUser!.tenantId);
  });

  it('tenantId is always set on ncsUser', () => {
    const req = makeReq();
    devAuthMiddleware(req as Request, makeRes() as unknown as Response, next);
    expect(typeof req.ncsUser!.tenantId).toBe('string');
    expect(req.ncsUser!.tenantId.length).toBeGreaterThan(0);
  });
});
