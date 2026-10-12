/**
 * N-CoreShift – AuthProvider abstraction
 *
 * Local: dev adapter with hard-coded users/roles.
 * Production: XSUAA / enterprise identity on BTP.
 */

export type NCoreShiftRole =
  | 'NCoreShift.User'
  | 'NCoreShift.Consultant'
  | 'NCoreShift.TechnicalConsultant'
  | 'NCoreShift.SolutionArchitect'
  | 'NCoreShift.CleanCoreApprover'
  | 'NCoreShift.ProjectAdmin'
  | 'NCoreShift.PlatformAdmin';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  displayName: string;
  roles: NCoreShiftRole[];
  tenantId: string;
}

export interface AuthProvider {
  readonly providerId: string;

  /** Return the authenticated user for the current request context, or null. */
  getCurrentUser(context: unknown): Promise<AuthenticatedUser | null>;

  /** Check whether the user holds a specific role. */
  hasRole(user: AuthenticatedUser, role: NCoreShiftRole): boolean;
}
