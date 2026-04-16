import { useEffect, useState } from 'react';

import type { ServerStatus } from '@shared/types';

/**
 * Poll AutoCAD connection status periodically so the header chip stays
 * in sync when the user opens/closes drawings. 3s is fast enough to feel
 * live without being chatty on the COM layer.
 */
export function useAutocadStatus(): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>({
    connected: false,
  });

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const s = await window.costEstimator.getAutocadStatus();
        if (alive) setStatus(s);
      } catch (e) {
        if (alive) setStatus({ connected: false, error: String(e) });
      }
    }
    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  return status;
}
