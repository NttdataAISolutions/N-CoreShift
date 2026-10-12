/**
 * N-CoreShift – TenantContext
 *
 * Exposes the current tenantId and projectId throughout the React tree.
 * Every data-fetching call and every backend operation must include these
 * identifiers so that records remain scoped to the correct tenant/project
 * (Permanent Principle 18).
 */

import React, { createContext, useContext, useState } from 'react';

export interface TenantContextValue {
  tenantId: string;
  projectId: string | null;
  setProjectId: (id: string | null) => void;
}

const TenantContext = createContext<TenantContextValue | null>(null);

interface TenantProviderProps {
  tenantId: string;
  children: React.ReactNode;
}

export function TenantProvider({ tenantId, children }: TenantProviderProps) {
  const [projectId, setProjectId] = useState<string | null>(null);

  return (
    <TenantContext.Provider value={{ tenantId, projectId, setProjectId }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error('useTenant must be used inside <TenantProvider>');
  }
  return ctx;
}
