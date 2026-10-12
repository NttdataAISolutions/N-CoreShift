/**
 * N-CoreShift – CDS Service Definition
 *
 * Phase 1: ping action
 * Phase 2: Landscape onboarding and readiness gate
 * Phase 3+: AI provider administration, source ingestion, etc.
 */
namespace ncoreshift;

using ncoreshift.db as db from '../db/schema';

// ── Main service ───────────────────────────────────────────────────────────

service NCoreShiftService @(path: '/api/ncoreshift') {

  // ── Health ─────────────────────────────────────────────────────────────
  action ping() returns String;

  // ── Projects ────────────────────────────────────────────────────────────
  entity Projects as projection on db.Project
    actions {
      action approve(approvedBy: String) returns String;
    };

  // ── Source System Profiles ──────────────────────────────────────────────
  entity SourceSystemProfiles as projection on db.SourceSystemProfile;

  // ── Target System Profiles ──────────────────────────────────────────────
  entity TargetSystemProfiles as projection on db.TargetSystemProfile;

  // ── Clean Core Policies ─────────────────────────────────────────────────
  entity CleanCorePolicies as projection on db.CleanCorePolicy;

  // ── Governance Policies ─────────────────────────────────────────────────
  entity GovernancePolicies as projection on db.GovernancePolicy;

  // ── Landscape Profile Versions ──────────────────────────────────────────
  entity LandscapeProfileVersions as projection on db.LandscapeProfileVersion;

  // ── Landscape Readiness Results ─────────────────────────────────────────
  entity LandscapeReadinessResults as projection on db.LandscapeReadinessResult;

  // ── Revalidation Flags ──────────────────────────────────────────────────
  entity RevalidationFlags as projection on db.RevalidationFlag;

  // ── Landscape actions ───────────────────────────────────────────────────

  /**
   * Compute and persist the landscape readiness for a project.
   * Returns the full readiness result JSON.
   */
  action computeReadiness(projectId: String) returns String;

  /**
   * Approve a project landscape for assessment.
   * Requires NCoreShift.CleanCoreApprover or NCoreShift.SolutionArchitect role.
   */
  action approveLandscape(projectId: String, approvedBy: String) returns String;

  /**
   * Gate check – returns assessmentAllowed and codeGenerationAllowed.
   * Called by analysis creation to enforce hard gates.
   */
  action checkLandscapeGate(projectId: String) returns String;
}
