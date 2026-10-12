/**
 * N-CoreShift – Development authentication adapter.
 *
 * Provides a fixed local user session for development / testing without
 * requiring BTP XSUAA. Reads the active persona from localStorage so the
 * dev-tools panel can switch roles without restarting.
 *
 * NEVER enable this adapter in production.
 */

import {
  NCS_ROLE,
  NCSRole,
  NCSUser,
  AuthAdapter,
  resolvePermissions,
} from './types';

const DEV_STORAGE_KEY = 'ncs_dev_roles';

const DEV_PERSONAS: Record<string, { name: string; email: string; roles: NCSRole[] }> = {
  platform_admin: {
    name: 'Dev Platform Admin',
    email: 'dev-admin@ncs.local',
    roles: [NCS_ROLE.PLATFORM_ADMIN],
  },
  consultant: {
    name: 'Dev Consultant',
    email: 'dev-consultant@ncs.local',
    roles: [NCS_ROLE.CONSULTANT],
  },
  solution_architect: {
    name: 'Dev Solution Architect',
    email: 'dev-arch@ncs.local',
    roles: [NCS_ROLE.SOLUTION_ARCHITECT],
  },
  approver: {
    name: 'Dev Clean Core Approver',
    email: 'dev-approver@ncs.local',
    roles: [NCS_ROLE.CLEAN_CORE_APPROVER],
  },
  user: {
    name: 'Dev User',
    email: 'dev-user@ncs.local',
    roles: [NCS_ROLE.USER],
  },
};

/** Default persona used when nothing is stored */
const DEFAULT_PERSONA = 'platform_admin';

function readStoredRoles(): NCSRole[] | null {
  try {
    const raw = localStorage.getItem(DEV_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as NCSRole[];
  } catch {
    // ignore
  }
  return null;
}

export function devSetRoles(roles: NCSRole[]): void {
  localStorage.setItem(DEV_STORAGE_KEY, JSON.stringify(roles));
}

export function devClearRoles(): void {
  localStorage.removeItem(DEV_STORAGE_KEY);
}

export class DevAuthAdapter implements AuthAdapter {
  async getCurrentUser(): Promise<NCSUser | null> {
    const storedRoles = readStoredRoles();
    const roles = storedRoles ?? DEV_PERSONAS[DEFAULT_PERSONA].roles;
    const persona = DEV_PERSONAS[DEFAULT_PERSONA];

    return {
      id: 'dev-user-001',
      name: storedRoles ? 'Dev User (custom roles)' : persona.name,
      email: storedRoles ? 'dev@ncs.local' : persona.email,
      roles,
      permissions: resolvePermissions(roles),
      tenantId: 'dev-tenant-001',
      isDevAuth: true,
    };
  }

  async signOut(): Promise<void> {
    devClearRoles();
    // In dev mode sign-out is a no-op beyond clearing local state.
  }
}
