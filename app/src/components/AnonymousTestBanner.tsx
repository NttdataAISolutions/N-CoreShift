/**
 * N-CoreShift – Anonymous Test Mode Banner (Gate 0E10-AT1A)
 *
 * Presentation-only indicator. Calls the safe GET /api/config/bootstrap
 * endpoint (backend/main.py) which exposes ONLY a boolean
 * `anonymousTestMode` flag — never secrets, tokens, client IDs, service
 * URLs, or destination configuration.
 *
 * This banner is advisory only. The authoritative security boundary is
 * the server-side 403 enforcement in backend/auth/anonymous_test.py
 * (centralized allowlist / default-deny). Removing or hiding this banner
 * has no effect on that enforcement.
 */

import React, { useEffect, useState } from 'react';

export default function AnonymousTestBanner() {
  const [anonymousTestMode, setAnonymousTestMode] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/config/bootstrap')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body?.data?.anonymousTestMode === true) {
          setAnonymousTestMode(true);
        }
      })
      .catch(() => {
        // Fail silently — absence of the banner is always safe.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!anonymousTestMode) return null;

  return (
    <div
      role="status"
      style={{
        background: '#fff8e1',
        borderBottom: '2px solid #e6a817',
        color: '#92400e',
        textAlign: 'center',
        fontSize: '0.82rem',
        fontWeight: 600,
        letterSpacing: '0.03em',
        padding: '0.4rem 1rem',
      }}
    >
      {'\u26A0\uFE0F'} TEST MODE — Anonymous Access
    </div>
  );
}
