/**
 * N-CoreShift – Backend auth types (Phase 1)
 *
 * Self-contained in the srv package so TypeScript rootDir boundaries are respected.
 * Roles and permissions mirror agent/src/auth/rbac.ts – keep in sync manually
 * until a shared-types workspace package is introduced in a future phase.
 *
 * In development the DevAuthMiddleware populates ServerUser from request headers.
 * In production a XSUAA adapter will populate it from a validated JWT.
 */

// ── Role definitions ──────────────────────────────────────────────────────────

export const ALL_NCS_ROLES = [
  'NCoreShift.User',
  'NCoreShift.Consultant',
  'NCoreShift.TechnicalConsultant',
  'NCoreShift.SolutionArchitect',
  'NCoreShift.CleanCoreApprover',
  'NCoreShift.ProjectAdmin',
  'NCoreShift.PlatformAdmin',
] as const;

export type NCSRole = (typeof ALL_NCS_ROLES)[number];

// ── Permission definitions ────────────────────────────────────────────────────

export const ALL_NCS_PERMISSIONS = [
  'project:read',
  'project:write',
  'project:delete',
  'landscape:read',
  'landscape:write',
  'landscape:approve',
  'analysis:read',
  'analysis:create',
  'analysis:approve',
  'inventory:read',
  'plan:read',
  'plan:write',
  'plan:approve',
  'artifact:read',
  'artifact:generate',
  'admin:read',
  'admin:write',
  'tenant:manage',
] as const;

export type NCSPermission = (typeof ALL_NCS_PERMISSIONS)[number];

// ── Role → Permission mapping ─────────────────────────────────────────────────

export const ROLE_PERMISSIONS: Record<NCSRole, readonly NCSPermission[]> = {
  'NCoreShift.User': ['project:read', 'landscape:read', 'analysis:read', 'inventory:read', 'plan:read', 'artifact:read'],
  'NCoreShift.Consultant': [
    'project:read',
    'project:write',
    'landscape:read',
    'landscape:write',
    'analysis:read',
    'analysis:create',
    'inventory:read',
    'plan:read',
    'plan:write',
    'artifact:read',
    'artifact:generate',
  ],
  'NCoreShift.TechnicalConsultant': [
    'project:read',
    'project:write',
    'landscape:read',
    'landscape:write',
    'analysis:read',
    'analysis:create',
    'inventory:read',
    'plan:read',
    'plan:write',
    'artifact:read',
    'artifact:generate',
  ],
  'NCoreShift.SolutionArchitect': [
    'project:read',
    'project:write',
    'landscape:read',
    'landscape:write',
    'analysis:read',
    'analysis:create',
    'analysis:approve',
    'inventory:read',
    'plan:read',
    'plan:write',
    'plan:approve',
    'artifact:read',
    'artifact:generate',
  ],
  'NCoreShift.CleanCoreApprover': [
    'project:read',
    'landscape:read',
    'landscape:approve',
    'analysis:read',
    'analysis:approve',
    'inventory:read',
    'plan:read',
    'plan:approve',
    'artifact:read',
  ],
  'NCoreShift.ProjectAdmin': [
    'project:read',
    'project:write',
    'project:delete',
    'landscape:read',
    'landscape:write',
    'landscape:approve',
    'analysis:read',
    'analysis:create',
    'analysis:approve',
    'inventory:read',
    'plan:read',
    'plan:write',
    'plan:approve',
    'artifact:read',
    'artifact:generate',
    'admin:read',
  ],
  'NCoreShift.PlatformAdmin': [...ALL_NCS_PERMISSIONS],
};

// ── Authenticated user ────────────────────────────────────────────────────────

export interface ServerUser {
  /** Unique user identifier (email, sub, etc.) */
  id: string;
  /** Display name */
  name: string;
  /** Tenant scope */
  tenantId: string;
  /** Assigned roles */
  roles: NCSRole[];
  /** Resolved permissions (derived from roles) */
  permissions: ReadonlySet<NCSPermission>;
  /** Whether this session came from the dev auth adapter */
  isDevAuth: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Resolve permissions from an array of roles */
export function resolveServerPermissions(roles: NCSRole[]): ReadonlySet<NCSPermission> {
  const perms = new Set<NCSPermission>();
  for (const role of roles) {
    const rp = ROLE_PERMISSIONS[role];
    if (rp) {
      for (const p of rp) perms.add(p);
    }
  }
  return perms;
}

/** Return true if the user holds the given permission */
export function userCan(user: ServerUser, permission: NCSPermission): boolean {
  return user.permissions.has(permission);
}

/** Return true if the user holds at least one of the given roles */
export function userHasRole(user: ServerUser, roles: NCSRole[]): boolean {
  return roles.some((r) => user.roles.includes(r));
}

// ── Express request augmentation ──────────────────────────────────────────────

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ncsUser?: ServerUser;
    }
  }
}
