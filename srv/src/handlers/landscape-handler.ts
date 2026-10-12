/**
 * N-CoreShift – Phase 2: Landscape Onboarding & Readiness Gate Handler
 *
 * Implements:
 *   - CRUD for Project, SourceSystemProfile, TargetSystemProfile,
 *     CleanCorePolicy, GovernancePolicy
 *   - Landscape readiness computation + persistence
 *   - Hard gates: assessment creation blocked when assessmentAllowed=false,
 *     code generation blocked when codeGenerationAllowed=false
 *   - Revalidation flags when target edition/release or Clean Core policy
 *     changes after assessments exist
 *   - Versioned landscape profile history for auditability
 *   - Tenant/project isolation on every operation
 *
 * Security principles:
 *   - All DB reads/writes are filtered by tenantId extracted from the
 *     authenticated request context (never trusted from request body).
 *   - Approval requires CleanCoreApprover or SolutionArchitect role.
 */

import { randomUUID } from 'crypto';
import {
  LandscapeReadinessInput,
  LandscapeReadinessService,
} from '../landscape/LandscapeReadinessService.js';
import type {
  CleanCorePolicy,
  GovernancePolicy,
  ProjectContext,
  SourceSystemProfile,
  TargetSystemProfile,
} from '../landscape/types.js';

// ── Minimal CDS-compatible DB abstraction ─────────────────────────────────
// In production the `db` object is injected by CAP's cds.connect().
// In tests it is replaced with the in-memory store below.

export interface LandscapeDB {
  run(query: unknown): Promise<unknown>;
  // SELECT helpers
  select(entity: string, where: Record<string, unknown>): Promise<unknown[]>;
  insert(entity: string, record: Record<string, unknown>): Promise<void>;
  update(
    entity: string,
    where: Record<string, unknown>,
    data: Record<string, unknown>,
  ): Promise<void>;
  delete(entity: string, where: Record<string, unknown>): Promise<void>;
}

// ── In-memory store for testing (replaces SQLite/HANA in unit tests) ──────

export class InMemoryLandscapeDB implements LandscapeDB {
  private stores: Map<string, Record<string, unknown>[]> = new Map();

  private getStore(entity: string): Record<string, unknown>[] {
    if (!this.stores.has(entity)) this.stores.set(entity, []);
    return this.stores.get(entity)!;
  }

  run(_query: unknown): Promise<unknown> {
    return Promise.resolve(null);
  }

  select(
    entity: string,
    where: Record<string, unknown>,
  ): Promise<unknown[]> {
    const store = this.getStore(entity);
    const keys = Object.keys(where);
    const result = store.filter((row) =>
      keys.every((k) => row[k] === where[k]),
    );
    return Promise.resolve(result);
  }

  async insert(entity: string, record: Record<string, unknown>): Promise<void> {
    this.getStore(entity).push({ ...record });
  }

  async update(
    entity: string,
    where: Record<string, unknown>,
    data: Record<string, unknown>,
  ): Promise<void> {
    const store = this.getStore(entity);
    const keys = Object.keys(where);
    for (const row of store) {
      if (keys.every((k) => row[k] === where[k])) {
        Object.assign(row, data);
      }
    }
  }

  async delete(entity: string, where: Record<string, unknown>): Promise<void> {
    const store = this.getStore(entity);
    const keys = Object.keys(where);
    const filtered = store.filter(
      (row) => !keys.every((k) => row[k] === where[k]),
    );
    this.stores.set(entity, filtered);
  }

  /** Test helper: dump all records for an entity */
  dump(entity: string): Record<string, unknown>[] {
    return this.getStore(entity);
  }

  /** Test helper: reset all stores */
  reset(): void {
    this.stores.clear();
  }
}

// ── Domain constants ──────────────────────────────────────────────────────

const ENTITIES = {
  Project: 'ncoreshift.db.Project',
  SourceSystemProfile: 'ncoreshift.db.SourceSystemProfile',
  TargetSystemProfile: 'ncoreshift.db.TargetSystemProfile',
  CleanCorePolicy: 'ncoreshift.db.CleanCorePolicy',
  GovernancePolicy: 'ncoreshift.db.GovernancePolicy',
  LandscapeProfileVersion: 'ncoreshift.db.LandscapeProfileVersion',
  LandscapeReadinessResult: 'ncoreshift.db.LandscapeReadinessResult',
  RevalidationFlag: 'ncoreshift.db.RevalidationFlag',
} as const;

const APPROVER_ROLES = [
  'NCoreShift.CleanCoreApprover',
  'NCoreShift.SolutionArchitect',
  'NCoreShift.PlatformAdmin',
];

// ── Error types ────────────────────────────────────────────────────────────

export class LandscapeGateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LandscapeGateError';
  }
}

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

// ── Request / response types ──────────────────────────────────────────────

export interface AuthContext {
  tenantId: string;
  userId: string;
  roles: string[];
}

export interface GateCheckResult {
  assessmentAllowed: boolean;
  codeGenerationAllowed: boolean;
  readinessState: string;
  completionPercent: number;
  missingRequiredFields: string[];
  warnings: string[];
}

// ── LandscapeHandler ──────────────────────────────────────────────────────

export class LandscapeHandler {
  private readonly svc = new LandscapeReadinessService();

  constructor(private readonly db: LandscapeDB) {}

  // ── Project ─────────────────────────────────────────────────────────────

  async createProject(
    auth: AuthContext,
    data: Omit<ProjectContext, 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<ProjectContext> {
    const now = new Date().toISOString();
    const record: ProjectContext = {
      ...data,
      id: data.id ?? randomUUID(),
      tenantId: auth.tenantId, // always from auth, never from body
      readinessState: 'DRAFT',
      createdAt: now,
      updatedAt: now,
      createdBy: data.createdBy ?? auth.userId,
    };
    await this.db.insert(ENTITIES.Project, record as unknown as Record<string, unknown>);
    await this._recordVersion(auth, record.id, 'PROJECT', 'Project created', record);
    return record;
  }

  async getProject(auth: AuthContext, projectId: string): Promise<ProjectContext> {
    const rows = await this.db.select(ENTITIES.Project, {
      id: projectId,
      tenantId: auth.tenantId, // tenant isolation
    });
    if (!rows.length) {
      throw new LandscapeGateError('NOT_FOUND', `Project ${projectId} not found`);
    }
    return rows[0] as unknown as ProjectContext;
  }

  async listProjects(auth: AuthContext): Promise<ProjectContext[]> {
    const rows = await this.db.select(ENTITIES.Project, { tenantId: auth.tenantId });
    return rows as unknown as ProjectContext[];
  }

  async updateProject(
    auth: AuthContext,
    projectId: string,
    data: Partial<ProjectContext>,
  ): Promise<ProjectContext> {
    const existing = await this.getProject(auth, projectId);
    const now = new Date().toISOString();
    const updated = { ...existing, ...data, tenantId: auth.tenantId, updatedAt: now };
    await this.db.update(
      ENTITIES.Project,
      { id: projectId, tenantId: auth.tenantId },
      updated as unknown as Record<string, unknown>,
    );
    await this._recordVersion(auth, projectId, 'PROJECT', 'Project updated', updated);
    return updated;
  }

  // ── Source System Profile ────────────────────────────────────────────────

  async upsertSourceSystem(
    auth: AuthContext,
    projectId: string,
    data: Omit<SourceSystemProfile, 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<SourceSystemProfile> {
    await this.getProject(auth, projectId); // ensures tenant owns project
    const existing = await this._getSourceSystem(auth, projectId);
    const now = new Date().toISOString();

    if (existing) {
      const updated: SourceSystemProfile = {
        ...existing,
        ...data,
        tenantId: auth.tenantId,
        projectId,
        updatedAt: now,
      };
      await this.db.update(
        ENTITIES.SourceSystemProfile,
        { projectId, tenantId: auth.tenantId },
        updated as unknown as Record<string, unknown>,
      );
      await this._recordVersion(auth, projectId, 'SOURCE_SYSTEM', 'Source system updated', updated);
      return updated;
    } else {
      const record: SourceSystemProfile = {
        ...data,
        id: data.id ?? randomUUID(),
        tenantId: auth.tenantId,
        projectId,
        createdAt: now,
        updatedAt: now,
      };
      await this.db.insert(ENTITIES.SourceSystemProfile, record as unknown as Record<string, unknown>);
      await this._recordVersion(auth, projectId, 'SOURCE_SYSTEM', 'Source system created', record);
      return record;
    }
  }

  async getSourceSystem(
    auth: AuthContext,
    projectId: string,
  ): Promise<SourceSystemProfile | null> {
    await this.getProject(auth, projectId);
    return this._getSourceSystem(auth, projectId);
  }

  private async _getSourceSystem(
    auth: AuthContext,
    projectId: string,
  ): Promise<SourceSystemProfile | null> {
    const rows = await this.db.select(ENTITIES.SourceSystemProfile, {
      projectId,
      tenantId: auth.tenantId,
    });
    return rows.length ? (rows[0] as unknown as SourceSystemProfile) : null;
  }

  // ── Target System Profile ────────────────────────────────────────────────

  async upsertTargetSystem(
    auth: AuthContext,
    projectId: string,
    data: Omit<TargetSystemProfile, 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<TargetSystemProfile> {
    await this.getProject(auth, projectId);
    const existing = await this._getTargetSystem(auth, projectId);
    const now = new Date().toISOString();

    if (existing) {
      // Check if critical fields changed – if so, flag revalidation
      const editionChanged =
        data.targetEdition !== undefined && data.targetEdition !== existing.targetEdition;
      const releaseChanged =
        data.targetRelease !== undefined && data.targetRelease !== existing.targetRelease;

      const updated: TargetSystemProfile = {
        ...existing,
        ...data,
        tenantId: auth.tenantId,
        projectId,
        updatedAt: now,
      };
      await this.db.update(
        ENTITIES.TargetSystemProfile,
        { projectId, tenantId: auth.tenantId },
        updated as unknown as Record<string, unknown>,
      );
      await this._recordVersion(auth, projectId, 'TARGET_SYSTEM', 'Target system updated', updated);

      if (editionChanged || releaseChanged) {
        await this._raiseRevalidationFlag(
          auth,
          projectId,
          'TARGET_CHANGED',
          `Target ${editionChanged ? 'edition' : ''}${editionChanged && releaseChanged ? '/' : ''}${releaseChanged ? 'release' : ''} changed after assessments`,
        );
      }
      return updated;
    } else {
      const record: TargetSystemProfile = {
        ...data,
        id: data.id ?? randomUUID(),
        tenantId: auth.tenantId,
        projectId,
        createdAt: now,
        updatedAt: now,
      };
      await this.db.insert(ENTITIES.TargetSystemProfile, record as unknown as Record<string, unknown>);
      await this._recordVersion(auth, projectId, 'TARGET_SYSTEM', 'Target system created', record);
      return record;
    }
  }

  async getTargetSystem(
    auth: AuthContext,
    projectId: string,
  ): Promise<TargetSystemProfile | null> {
    await this.getProject(auth, projectId);
    return this._getTargetSystem(auth, projectId);
  }

  private async _getTargetSystem(
    auth: AuthContext,
    projectId: string,
  ): Promise<TargetSystemProfile | null> {
    const rows = await this.db.select(ENTITIES.TargetSystemProfile, {
      projectId,
      tenantId: auth.tenantId,
    });
    return rows.length ? (rows[0] as unknown as TargetSystemProfile) : null;
  }

  // ── Clean Core Policy ────────────────────────────────────────────────────

  async upsertCleanCorePolicy(
    auth: AuthContext,
    projectId: string,
    data: Omit<CleanCorePolicy, 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<CleanCorePolicy> {
    await this.getProject(auth, projectId);
    const existing = await this._getCleanCorePolicy(auth, projectId);
    const now = new Date().toISOString();

    if (existing) {
      const postureChanged =
        data.posture !== undefined && data.posture !== existing.posture;

      const updated: CleanCorePolicy = {
        ...existing,
        ...data,
        tenantId: auth.tenantId,
        projectId,
        updatedAt: now,
      };
      await this.db.update(
        ENTITIES.CleanCorePolicy,
        { projectId, tenantId: auth.tenantId },
        updated as unknown as Record<string, unknown>,
      );
      await this._recordVersion(auth, projectId, 'CLEAN_CORE_POLICY', 'Clean Core policy updated', updated);

      if (postureChanged) {
        await this._raiseRevalidationFlag(
          auth,
          projectId,
          'POLICY_CHANGED',
          'Clean Core policy posture changed after assessments',
        );
      }
      return updated;
    } else {
      const record: CleanCorePolicy = {
        ...data,
        id: data.id ?? randomUUID(),
        tenantId: auth.tenantId,
        projectId,
        createdAt: now,
        updatedAt: now,
      };
      await this.db.insert(
        ENTITIES.CleanCorePolicy,
        record as unknown as Record<string, unknown>,
      );
      await this._recordVersion(
        auth,
        projectId,
        'CLEAN_CORE_POLICY',
        'Clean Core policy created',
        record,
      );
      return record;
    }
  }

  async getCleanCorePolicy(
    auth: AuthContext,
    projectId: string,
  ): Promise<CleanCorePolicy | null> {
    await this.getProject(auth, projectId);
    return this._getCleanCorePolicy(auth, projectId);
  }

  private async _getCleanCorePolicy(
    auth: AuthContext,
    projectId: string,
  ): Promise<CleanCorePolicy | null> {
    const rows = await this.db.select(ENTITIES.CleanCorePolicy, {
      projectId,
      tenantId: auth.tenantId,
    });
    return rows.length ? (rows[0] as unknown as CleanCorePolicy) : null;
  }

  // ── Governance Policy ────────────────────────────────────────────────────

  async upsertGovernancePolicy(
    auth: AuthContext,
    projectId: string,
    data: Omit<GovernancePolicy, 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<GovernancePolicy> {
    await this.getProject(auth, projectId);
    const existing = await this._getGovernancePolicy(auth, projectId);
    const now = new Date().toISOString();

    if (existing) {
      const updated: GovernancePolicy = {
        ...existing,
        ...data,
        tenantId: auth.tenantId,
        projectId,
        updatedAt: now,
      };
      await this.db.update(
        ENTITIES.GovernancePolicy,
        { projectId, tenantId: auth.tenantId },
        updated as unknown as Record<string, unknown>,
      );
      await this._recordVersion(
        auth,
        projectId,
        'GOVERNANCE_POLICY',
        'Governance policy updated',
        updated,
      );
      return updated;
    } else {
      const record: GovernancePolicy = {
        ...data,
        id: data.id ?? randomUUID(),
        tenantId: auth.tenantId,
        projectId,
        createdAt: now,
        updatedAt: now,
      };
      await this.db.insert(
        ENTITIES.GovernancePolicy,
        record as unknown as Record<string, unknown>,
      );
      await this._recordVersion(
        auth,
        projectId,
        'GOVERNANCE_POLICY',
        'Governance policy created',
        record,
      );
      return record;
    }
  }

  async getGovernancePolicy(
    auth: AuthContext,
    projectId: string,
  ): Promise<GovernancePolicy | null> {
    await this.getProject(auth, projectId);
    return this._getGovernancePolicy(auth, projectId);
  }

  private async _getGovernancePolicy(
    auth: AuthContext,
    projectId: string,
  ): Promise<GovernancePolicy | null> {
    const rows = await this.db.select(ENTITIES.GovernancePolicy, {
      projectId,
      tenantId: auth.tenantId,
    });
    return rows.length ? (rows[0] as unknown as GovernancePolicy) : null;
  }

  // ── Readiness ────────────────────────────────────────────────────────────

  async computeReadiness(
    auth: AuthContext,
    projectId: string,
  ): Promise<import('../landscape/types.js').LandscapeReadinessResult> {
    const project = await this.getProject(auth, projectId);
    const sourceSystem = await this._getSourceSystem(auth, projectId);
    const targetSystem = await this._getTargetSystem(auth, projectId);
    const cleanCorePolicy = await this._getCleanCorePolicy(auth, projectId);
    const governancePolicy = await this._getGovernancePolicy(auth, projectId);

    const approvalRows = await this.db.select(ENTITIES.LandscapeReadinessResult, {
      projectId,
      tenantId: auth.tenantId,
    });
    const latestApproval = approvalRows.length
      ? (approvalRows[approvalRows.length - 1] as Record<string, unknown>)
      : undefined;

    const input: LandscapeReadinessInput = {
      project,
      sourceSystem,
      targetSystem,
      cleanCorePolicy,
      governancePolicy,
      existingApproval: latestApproval
        ? {
            assessmentApprovedBy: latestApproval['approvedBy'] as string | undefined,
            assessmentApprovedAt: latestApproval['approvedAt'] as string | undefined,
            codeGenerationApprovedBy: latestApproval['codeGenerationApprovedBy'] as
              | string
              | undefined,
          }
        : undefined,
    };

    const result = this.svc.compute(input);

    // Persist latest readiness snapshot
    await this.db.update(
      ENTITIES.LandscapeReadinessResult,
      { projectId, tenantId: auth.tenantId },
      result as unknown as Record<string, unknown>,
    );

    // Also update project readinessState
    await this.db.update(
      ENTITIES.Project,
      { id: projectId, tenantId: auth.tenantId },
      { readinessState: result.readinessState, updatedAt: new Date().toISOString() },
    );

    return result;
  }

  // ── Hard gates ───────────────────────────────────────────────────────────

  /** Throws LandscapeGateError if assessment is not allowed. */
  async assertAssessmentAllowed(
    auth: AuthContext,
    projectId: string,
  ): Promise<void> {
    const readiness = await this.computeReadiness(auth, projectId);
    if (!readiness.assessmentAllowed) {
      const missing = readiness.missingRequiredFields.map((f) => f.field).join(', ');
      throw new LandscapeGateError(
        'ASSESSMENT_BLOCKED',
        `Landscape setup incomplete. Complete the Source System, Target System, and Clean Core Policy before starting assessment. Missing: ${missing}`,
      );
    }
  }

  /** Throws LandscapeGateError if code generation is not allowed. */
  async assertCodeGenerationAllowed(
    auth: AuthContext,
    projectId: string,
  ): Promise<void> {
    const readiness = await this.computeReadiness(auth, projectId);
    if (!readiness.codeGenerationAllowed) {
      throw new LandscapeGateError(
        'CODE_GENERATION_BLOCKED',
        `Code generation is blocked. Ensure landscape is fully approved, target release is specified, and an approved modernization plan exists.`,
      );
    }
  }

  // ── Approval ─────────────────────────────────────────────────────────────

  async approveForAssessment(
    auth: AuthContext,
    projectId: string,
  ): Promise<void> {
    this._requireRole(auth, APPROVER_ROLES);
    const readiness = await this.computeReadiness(auth, projectId);
    if (!readiness.assessmentAllowed) {
      throw new LandscapeGateError(
        'CANNOT_APPROVE_INCOMPLETE',
        'Cannot approve: landscape readiness requirements not met.',
      );
    }
    const now = new Date().toISOString();
    await this.db.update(
      ENTITIES.LandscapeReadinessResult,
      { projectId, tenantId: auth.tenantId },
      {
        approvedBy: auth.userId,
        approvedAt: now,
        readinessState: 'APPROVED_FOR_ASSESSMENT',
      },
    );
    await this.db.update(
      ENTITIES.Project,
      { id: projectId, tenantId: auth.tenantId },
      { readinessState: 'APPROVED_FOR_ASSESSMENT', updatedAt: now },
    );
    await this._recordVersion(auth, projectId, 'APPROVAL', 'Approved for assessment', {
      approvedBy: auth.userId,
      approvedAt: now,
    });
  }

  async approveForCodeGeneration(
    auth: AuthContext,
    projectId: string,
  ): Promise<void> {
    this._requireRole(auth, APPROVER_ROLES);
    const readiness = await this.computeReadiness(auth, projectId);
    if (!readiness.assessmentAllowed) {
      throw new LandscapeGateError(
        'CANNOT_APPROVE_INCOMPLETE',
        'Cannot approve for code generation: landscape readiness requirements not met.',
      );
    }
    const now = new Date().toISOString();
    await this.db.update(
      ENTITIES.LandscapeReadinessResult,
      { projectId, tenantId: auth.tenantId },
      {
        codeGenerationApprovedBy: auth.userId,
        codeGenerationApprovedAt: now,
        readinessState: 'APPROVED_FOR_CODE_GENERATION',
      },
    );
    await this.db.update(
      ENTITIES.Project,
      { id: projectId, tenantId: auth.tenantId },
      { readinessState: 'APPROVED_FOR_CODE_GENERATION', updatedAt: now },
    );
    await this._recordVersion(
      auth,
      projectId,
      'APPROVAL',
      'Approved for code generation',
      { approvedBy: auth.userId, approvedAt: now },
    );
  }

  // ── Revalidation flags ────────────────────────────────────────────────────

  async getRevalidationFlags(
    auth: AuthContext,
    projectId: string,
  ): Promise<Record<string, unknown>[]> {
    await this.getProject(auth, projectId);
    const rows = await this.db.select(ENTITIES.RevalidationFlag, {
      projectId,
      tenantId: auth.tenantId,
    });
    return rows as Record<string, unknown>[];
  }

  private async _raiseRevalidationFlag(
    auth: AuthContext,
    projectId: string,
    reason: string,
    description: string,
  ): Promise<void> {
    const flag = {
      id: randomUUID(),
      tenantId: auth.tenantId,
      projectId,
      reason,
      description,
      raisedAt: new Date().toISOString(),
      raisedBy: auth.userId,
      resolved: false,
    };
    await this.db.insert(
      ENTITIES.RevalidationFlag,
      flag as unknown as Record<string, unknown>,
    );
  }

  // ── Profile version history ───────────────────────────────────────────────

  async getVersionHistory(
    auth: AuthContext,
    projectId: string,
  ): Promise<Record<string, unknown>[]> {
    await this.getProject(auth, projectId);
    const rows = await this.db.select(ENTITIES.LandscapeProfileVersion, {
      projectId,
      tenantId: auth.tenantId,
    });
    return rows as Record<string, unknown>[];
  }

  private async _recordVersion(
    auth: AuthContext,
    projectId: string,
    section: string,
    changeDescription: string,
    snapshot: unknown,
  ): Promise<void> {
    const version = {
      id: randomUUID(),
      tenantId: auth.tenantId,
      projectId,
      section,
      changeDescription,
      changedBy: auth.userId,
      changedAt: new Date().toISOString(),
      snapshot: JSON.stringify(snapshot),
    };
    await this.db.insert(
      ENTITIES.LandscapeProfileVersion,
      version as unknown as Record<string, unknown>,
    );
  }

  // ── Role helper ───────────────────────────────────────────────────────────

  private _requireRole(auth: AuthContext, roles: string[]): void {
    const hasRole = auth.roles.some((r) => roles.includes(r));
    if (!hasRole) {
      throw new UnauthorizedError(
        `This action requires one of the following roles: ${roles.join(', ')}`,
      );
    }
  }
}
