/**
 * N-CoreShift – AuthContext
 *
 * Provides the current user, permission helpers, and sign-out to the entire
 * React tree. Uses an AuthAdapter so the local dev adapter and a future BTP
 * XSUAA adapter are interchangeable without changing any consumer.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import {
  AuthAdapter,
  AuthContextValue,
  NCSPermission,
  NCSRole,
  NCSUser,
  resolvePermissions,
} from './types';
import { DevAuthAdapter, devSetRoles } from './DevAuthAdapter';

// ── Adapter factory ───────────────────────────────────────────────────────────

/** In production replace this with a BTP XSUAA adapter. */
function createAuthAdapter(): AuthAdapter {
  return new DevAuthAdapter();
}

// ── Context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

interface AuthProviderProps {
  children: React.ReactNode;
  /** Override the adapter (useful in tests) */
  adapter?: AuthAdapter;
}

export function AuthProvider({ children, adapter }: AuthProviderProps) {
  const authAdapter = adapter ?? createAuthAdapter();

  const [user, setUser] = useState<NCSUser | null | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  // isLoading starts as true (useState(true)); no synchronous setState in the
  // effect body - all mutations happen inside async .then/.catch/.finally
  // callbacks, satisfying react-hooks/set-state-in-effect.
  useEffect(() => {
    let cancelled = false;
    authAdapter
      .getCurrentUser()
      .then((resolved) => {
        if (!cancelled) setUser(resolved);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const can = useCallback(
    (permission: NCSPermission): boolean => {
      return user?.permissions.has(permission) ?? false;
    },
    [user],
  );

  const hasRole = useCallback(
    (roles: NCSRole[]): boolean => {
      if (!user) return false;
      return roles.some((r) => user.roles.includes(r));
    },
    [user],
  );

  const signOut = useCallback(async () => {
    await authAdapter.signOut();
    setUser(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Dev-mode only: hot-swap the active roles without a page reload */
  const devSwitchRole = useCallback(
    (roles: NCSRole[]) => {
      if (!user?.isDevAuth) return;
      devSetRoles(roles);
      const updated: NCSUser = {
        ...user,
        roles,
        permissions: resolvePermissions(roles),
      };
      setUser(updated);
    },
    [user],
  );

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticated: user != null,
    can,
    hasRole,
    signOut,
    devSwitchRole: user?.isDevAuth ? devSwitchRole : undefined,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
