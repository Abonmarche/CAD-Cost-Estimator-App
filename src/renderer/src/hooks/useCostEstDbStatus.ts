import { useEffect, useState } from 'react';

import type { CostEstDbStatus } from '@shared/types';

/**
 * Poll the CostEstDB MCP connection so the header chip reflects whether
 * pricing lookups will work. Slower cadence than the AutoCAD poll because
 * it does an actual round-trip to Azure — 10s is responsive enough to
 * notice an outage without burning bandwidth on a healthy connection.
 */
export function useCostEstDbStatus(): CostEstDbStatus {
  const [status, setStatus] = useState<CostEstDbStatus>({ connected: false });

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const s = await window.costEstimator.getCostEstDbStatus();
        if (alive) setStatus(s);
      } catch (e) {
        if (alive) setStatus({ connected: false, error: String(e) });
      }
    }
    poll();
    const interval = setInterval(poll, 10_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  return status;
}
