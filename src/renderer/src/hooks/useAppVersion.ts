import { useEffect, useState } from 'react';

/**
 * Fetches the running app's version from the main process once on mount.
 * Returned as `null` until the IPC roundtrip completes — should be a few
 * milliseconds, but components should handle the loading state.
 */
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    window.costEstimator
      .getAppVersion()
      .then((v) => {
        if (alive) setVersion(v);
      })
      .catch(() => {
        // Non-fatal — header will just hide the version if this fails.
      });
    return () => {
      alive = false;
    };
  }, []);

  return version;
}
