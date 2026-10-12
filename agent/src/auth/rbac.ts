/**
 * N-CoreShift – RBAC role and permission definitions.
 *
 * These roles and permissions are the authoritative source used by both the
 * frontend (AuthContext) and backend (auth middleware / CDS annotations).
 * A future BTP XSUAA xs-security.json must define the same role names.
 *
 * Principle 18: all enforcement must also be scoped by tenantId + projectId.
 */

// ── Roles ─────────────────────────────────────────────────────────────────────

export const NCS_ROLE = {
  USER: 'NCoreShift.User',
  CONSULTANT: 'NCoreShift.Consultant',
  TECHNICAL_CONSULTANT: 'NCoreShift.TechnicalConsultant',
  SOLUTION_ARCHITECT: 'NCoreShift.SolutionArchitect',
  CLEAN_CORE_APPROVER: 'NCoreShift.CleanCoreApprover',
  PROJECT_ADMIN: 'NCoreShift.ProjectAdmin',
  PLATFORM_ADMIN: 'NCoreShift.PlatformAdmin',
} as const;

export type NCSRole = (typeof NCS_ROLE)[keyof typeof NCS_ROLE];

export const ALL_NCS_ROLES: NCSRole[] = Object.values(NCS_ROLE);

export const NCS_ROLE_LABELS: Record<NCSRole, string> = {
  [NCS_ROLE.USER]: 'User',
  [NCS_ROLE.CONSULTANT]: 'Consultant',
  [NCS_ROLE.TECHNICAL_CONSULTANT]: 'Technical Consultant',
  [NCS_ROLE.SOLUTION_ARCHITECT]: 'Solution Architect',
  [NCS_ROLE.CLEAN_CORE_APPROVER]: 'Clean Core Approver',
  [NCS_ROLE.PROJECT_ADMIN]: 'Project Administrator',
  [NCS_ROLE.PLATFORM_ADMIN]: 'Platform Administrator',
};

export const NCS_ROLE_DESCRIPTIONS: Record<NCSRole, string> = {
  [NCS_ROLE.USER]:
    'Can view projects, landscape profiles, analyses, and object inventory.',
  [NCS_ROLE.CONSULTANT]:
    'Can create analyses, review functional intent, and edit object dispositions.',
  [NCS_ROLE.TECHNICAL_CONSULTANT]:
    'Can perform technical dependency analysis and edit technical findings.',
  [NCS_ROLE.SOLUTION_ARCHITECT]:
    'Can approve architecture decisions and modernization plans.',
  [NCS_ROLE.CLEAN_CORE_APPROVER]:
    'Can approve Clean Core assessments and landscape readiness gates.',
  [NCS_ROLE.PROJECT_ADMIN]:
    'Can create and manage projects and landscape profiles.',
  [NCS_ROLE.PLATFORM_ADMIN]:
    'Can configure AI providers, manage system-wide settings, and view audit logs.',
};

// ── Permissions ───────────────────────────────────────────────────────────────

export const NCS_PERMISSION = {
  // Projects
  READ_PROJECT: 'read:project',
  WRITE_PROJECT: 'write:project',
  DELETE_PROJECT: 'delete:project',

  // Landscape profiles
  READ_LANDSCAPE: 'read:landscape',
  WRITE_LANDSCAPE: 'write:landscape',
  APPROVE_LANDSCAPE: 'approve:landscape',

  // Source ingestion / analyses
  READ_ANALYSIS: 'read:analysis',
  WRITE_ANALYSIS: 'write:analysis',
  DELETE_ANALYSIS: 'delete:analysis',

  // Object inventory
  READ_OBJECT_INVENTORY: 'read:object_inventory',
  WRITE_OBJECT_INVENTORY: 'write:object_inventory',

  // Functional intent
  READ_FUNCTIONAL_INTENT: 'read:functional_intent',
  APPROVE_FUNCTIONAL_INTENT: 'approve:functional_intent',

  // Clean Core assessment
  READ_ASSESSMENT: 'read:assessment',
  WRITE_ASSESSMENT: 'write:assessment',
  APPROVE_ASSESSMENT: 'approve:assessment',

  // Modernization plans
  READ_PLAN: 'read:plan',
  WRITE_PLAN: 'write:plan',
  APPROVE_PLAN: 'approve:plan',

  // Generated artifacts
  READ_ARTIFACT: 'read:artifact',
  WRITE_ARTIFACT: 'write:artifact',

  // Administration
  MANAGE_AI_PROVIDER: 'manage:ai_provider',
  VIEW_AUDIT_LOG: 'view:audit_log',
  MANAGE_PLATFORM: 'manage:platform',
} as const;

export type NCSPermission = (typeof NCS_PERMISSION)[keyof typeof NCS_PERMISSION];

// ── Role → Permission mapping ─────────────────────────────────────────────────

export const ROLE_PERMISSIONS: Record<NCSRole, NCSPermission[]> = {
  [NCS_ROLE.USER]: [
    NCS_PERMISSION.READ_PROJECT,
    NCS_PERMISSION.READ_LANDSCAPE,
    NCS_PERMISSION.READ_ANALYSIS,
    NCS_PERMISSION.READ_OBJECT_INVENTORY,
    NCS_PERMISSION.READ_FUNCTIONAL_INTENT,
    NCS_PERMISSION.READ_ASSESSMENT,
    NCS_PERMISSION.READ_PLAN,
    NCS_PERMISSION.READ_ARTIFACT,
  ],

  [NCS_ROLE.CONSULTANT]: [
    NCS_PERMISSION.READ_PROJECT,
    NCS_PERMISSION.READ_LANDSCAPE,
    NCS_PERMISSION.READ_ANALYSIS,
    NCS_PERMISSION.WRITE_ANALYSIS,
    NCS_PERMISSION.READ_OBJECT_INVENTORY,
    NCS_PERMISSION.WRITE_OBJECT_INVENTORY,
    NCS_PERMISSION.READ_FUNCTIONAL_INTENT,
    NCS_PERMISSION.APPROVE_FUNCTIONAL_INTENT,
    NCS_PERMISSION.READ_ASSESSMENT,
    NCS_PERMISSION.READ_PLAN,
    NCS_PERMISSION.WRITE_PLAN,
    NCS_PERMISSION.READ_ARTIFACT,
  ],

  [NCS_ROLE.TECHNICAL_CONSULTANT]: [
    NCS_PERMISSION.READ_PROJECT,
    NCS_PERMISSION.READ_LANDSCAPE,
    NCS_PERMISSION.READ_ANALYSIS,
    NCS_PERMISSION.WRITE_ANALYSIS,
    NCS_PERMISSION.READ_OBJECT_INVENTORY,
    NCS_PERMISSION.WRITE_OBJECT_INVENTORY,
    NCS_PERMISSION.READ_FUNCTIONAL_INTENT,
    NCS_PERMISSION.APPROVE_FUNCTIONAL_INTENT,
    NCS_PERMISSION.READ_ASSESSMENT,
    NCS_PERMISSION.WRITE_ASSESSMENT,
    NCS_PERMISSION.READ_PLAN,
    NCS_PERMISSION.WRITE_PLAN,
    NCS_PERMISSION.READ_ARTIFACT,
    NCS_PERMISSION.WRITE_ARTIFACT,
  ],

  [NCS_ROLE.SOLUTION_ARCHITECT]: [
    NCS_PERMISSION.READ_PROJECT,
    NCS_PERMISSION.READ_LANDSCAPE,
    NCS_PERMISSION.READ_ANALYSIS,
    NCS_PERMISSION.READ_OBJECT_INVENTORY,
    NCS_PERMISSION.READ_FUNCTIONAL_INTENT,
    NCS_PERMISSION.APPROVE_FUNCTIONAL_INTENT,
    NCS_PERMISSION.READ_ASSESSMENT,
    NCS_PERMISSION.WRITE_ASSESSMENT,
    NCS_PERMISSION.APPROVE_ASSESSMENT,
    NCS_PERMISSION.READ_PLAN,
    NCS_PERMISSION.WRITE_PLAN,
    NCS_PERMISSION.APPROVE_PLAN,
    NCS_PERMISSION.READ_ARTIFACT,
    NCS_PERMISSION.VIEW_AUDIT_LOG,
  ],

  [NCS_ROLE.CLEAN_CORE_APPROVER]: [
    NCS_PERMISSION.READ_PROJECT,
    NCS_PERMISSION.READ_LANDSCAPE,
    NCS_PERMISSION.APPROVE_LANDSCAPE,
    NCS_PERMISSION.READ_ANALYSIS,
    NCS_PERMISSION.READ_OBJECT_INVENTORY,
    NCS_PERMISSION.READ_FUNCTIONAL_INTENT,
    NCS_PERMISSION.APPROVE_FUNCTIONAL_INTENT,
    NCS_PERMISSION.READ_ASSESSMENT,
    NCS_PERMISSION.APPROVE_ASSESSMENT,
    NCS_PERMISSION.READ_PLAN,
    NCS_PERMISSION.APPROVE_PLAN,
    NCS_PERMISSION.READ_ARTIFACT,
    NCS_PERMISSION.VIEW_AUDIT_LOG,
  ],

  [NCS_ROLE.PROJECT_ADMIN]: [
    NCS_PERMISSION.READ_PROJECT,
    NCS_PERMISSION.WRITE_PROJECT,
    NCS_PERMISSION.DELETE_PROJECT,
    NCS_PERMISSION.READ_LANDSCAPE,
    NCS_PERMISSION.WRITE_LANDSCAPE,
    NCS_PERMISSION.APPROVE_LANDSCAPE,
    NCS_PERMISSION.READ_ANALYSIS,
    NCS_PERMISSION.WRITE_ANALYSIS,
    NCS_PERMISSION.DELETE_ANALYSIS,
    NCS_PERMISSION.READ_OBJECT_INVENTORY,
    NCS_PERMISSION.WRITE_OBJECT_INVENTORY,
    NCS_PERMISSION.READ_FUNCTIONAL_INTENT,
    NCS_PERMISSION.APPROVE_FUNCTIONAL_INTENT,
    NCS_PERMISSION.READ_ASSESSMENT,
    NCS_PERMISSION.WRITE_ASSESSMENT,
    NCS_PERMISSION.READ_PLAN,
    NCS_PERMISSION.WRITE_PLAN,
    NCS_PERMISSION.READ_ARTIFACT,
    NCS_PERMISSION.VIEW_AUDIT_LOG,
  ],

  [NCS_ROLE.PLATFORM_ADMIN]: [
    // Platform Admin inherits all permissions
    ...Object.values(NCS_PERMISSION),
  ],
};

// ── Permission helpers ────────────────────────────────────────────────────────

/**
 * Returns the merged set of permissions for the given list of roles.
 */
export function getPermissionsForRoles(roles: NCSRole[]): Set<NCSPermission> {
  const perms = new Set<NCSPermission>();
  for (const role of roles) {
    const rolePerms = ROLE_PERMISSIONS[role] ?? [];
    for (const p of rolePerms) {
      perms.add(p);
    }
  }
  return perms;
}

/**
 * Returns true if any of the supplied roles grants the requested permission.
 */
export function hasPermission(
  roles: NCSRole[],
  permission: NCSPermission,
): boolean {
  return getPermissionsForRoles(roles).has(permission);
}

/**
 * Returns true if any of the supplied roles matches any of the required roles.
 */
export function hasRole(userRoles: NCSRole[], requiredRoles: NCSRole[]): boolean {
  return requiredRoles.some((r) => userRoles.includes(r));
}
