/**
 * N-CoreShift – ShellPlaceholder
 *
 * Used for shell pages that are defined in the navigation but whose
 * full implementation is deferred to a later phase. Renders enough
 * structure to confirm routing works and future development context.
 */

import React from 'react';

interface ShellPlaceholderProps {
  title: string;
  description: string;
  phase: string;
  icon?: string;
}

export function ShellPlaceholder({ title, description, phase, icon = '🔧' }: ShellPlaceholderProps) {
  return (
    <div className="ncs-shell-placeholder">
      <div className="ncs-shell-placeholder__icon">{icon}</div>
      <h1 className="ncs-shell-placeholder__title">{title}</h1>
      <p className="ncs-shell-placeholder__desc">{description}</p>
      <span className="ncs-shell-placeholder__phase">Implemented in {phase}</span>
    </div>
  );
}
