import { useEffect, useRef, useState } from 'react';

import type {
  CostEstDbStatus,
  MeasurementType,
  ServerStatus,
  UpdateCheckResult,
} from '@shared/types';

import { useAppVersion } from '../hooks/useAppVersion';

interface Stats {
  complete: number;
  flagged: number;
  pending: number;
  total: number;
}

interface Props {
  status: ServerStatus;
  mcpStatus: CostEstDbStatus;
  stats: Stats;
  unitLabels: Record<MeasurementType, string>;
}

export function ProjectHeader({ status, mcpStatus, stats }: Props) {
  return (
    <header
      style={{
        padding: '14px 24px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            background:
              'linear-gradient(135deg, var(--abonmarche-navy), #1e3a5f)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--abonmarche-red)',
          }}
        >
          A
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>
            Cost Estimator
          </div>
          <VersionLine />
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          fontSize: 12,
        }}
      >
        <StatusChip status={status} />
        <McpStatusChip status={mcpStatus} />
        {stats.complete + stats.flagged + stats.pending > 0 && (
          <>
            {stats.complete > 0 && (
              <span style={{ color: 'var(--accent-green)' }}>
                ✓ {stats.complete} complete
              </span>
            )}
            {stats.flagged > 0 && (
              <span style={{ color: 'var(--accent-amber)' }}>
                ⚠ {stats.flagged} needs review
              </span>
            )}
            {stats.pending > 0 && (
              <span style={{ color: 'var(--text-dim)' }}>
                {stats.pending} pending
              </span>
            )}
            <span
              style={{
                color: 'var(--text-muted)',
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 600,
              }}
            >
              ${stats.total.toLocaleString()}
            </span>
          </>
        )}
      </div>
    </header>
  );
}

/**
 * Version display + manual update check trigger. Lives under the app title
 * so it's always visible without competing with the run-state info on the
 * right-hand side. Clicking the version triggers an update check; the
 * result is shown inline for ~6s, errors stick until the next click.
 */
function VersionLine() {
  const version = useAppVersion();
  const [check, setCheck] = useState<{
    state: 'idle' | 'checking' | 'done';
    result?: UpdateCheckResult;
  }>({ state: 'idle' });
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, []);

  async function runCheck() {
    if (check.state === 'checking') return;
    if (clearTimer.current) {
      clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
    setCheck({ state: 'checking' });
    try {
      const result = await window.costEstimator.checkForUpdates();
      setCheck({ state: 'done', result });
      // Errors and unconfigured-feed states should stick — the user may
      // need to act on them. Successful "up to date" or "downloading"
      // messages auto-clear so the version line returns to its quiet state.
      if (result.status === 'up-to-date' || result.status === 'downloading') {
        clearTimer.current = setTimeout(
          () => setCheck({ state: 'idle' }),
          6000,
        );
      }
    } catch (e) {
      setCheck({
        state: 'done',
        result: {
          status: 'error',
          currentVersion: version ?? '?',
          message: (e as Error).message ?? 'Check failed.',
        },
      });
    }
  }

  if (!version) {
    return (
      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        AutoCAD + CostEstDB
      </div>
    );
  }

  const checkLabel = renderCheckLabel(check);

  return (
    <div
      style={{
        fontSize: 11,
        color: 'var(--text-dim)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <button
        type="button"
        onClick={runCheck}
        title="Click to check for updates"
        disabled={check.state === 'checking'}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          color: 'var(--text-dim)',
          fontSize: 11,
          fontFamily: 'inherit',
          cursor: check.state === 'checking' ? 'wait' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
        onMouseEnter={(e) => {
          if (check.state !== 'checking') {
            e.currentTarget.style.color = 'var(--text-primary)';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-dim)';
        }}
      >
        <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          v{version}
        </span>
        <BetaBadge />
      </button>
      <span style={{ color: 'var(--text-muted)' }}>·</span>
      <span>AutoCAD + CostEstDB</span>
      {checkLabel && (
        <>
          <span style={{ color: 'var(--text-muted)' }}>·</span>
          {checkLabel}
        </>
      )}
    </div>
  );
}

function BetaBadge() {
  return (
    <span
      style={{
        background: 'rgba(245, 158, 11, 0.18)',
        color: 'var(--accent-amber)',
        padding: '1px 6px',
        borderRadius: 4,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}
    >
      Beta
    </span>
  );
}

function renderCheckLabel(check: {
  state: 'idle' | 'checking' | 'done';
  result?: UpdateCheckResult;
}) {
  if (check.state === 'idle') return null;
  if (check.state === 'checking') {
    return (
      <span style={{ color: 'var(--text-muted)' }}>Checking for updates…</span>
    );
  }
  const r = check.result;
  if (!r) return null;
  switch (r.status) {
    case 'up-to-date':
      return (
        <span style={{ color: 'var(--accent-green)' }}>
          ✓ You’re on the latest version
        </span>
      );
    case 'update-available':
      return (
        <span style={{ color: 'var(--accent-amber)' }}>
          Update v{r.latestVersion} available
        </span>
      );
    case 'downloading':
      return (
        <span style={{ color: 'var(--accent-amber)' }}>
          ↓ v{r.latestVersion} downloading — restart prompt will appear
        </span>
      );
    case 'check-running':
      return <span style={{ color: 'var(--text-muted)' }}>{r.message}</span>;
    case 'disabled':
      return (
        <span style={{ color: 'var(--text-muted)' }} title={r.message}>
          Updates unavailable
        </span>
      );
    case 'error':
      return (
        <span style={{ color: 'var(--accent-red)' }} title={r.message}>
          Check failed
        </span>
      );
    default: {
      // Exhaustiveness guard.
      const _exhaustive: never = r;
      void _exhaustive;
      return null;
    }
  }
}

function StatusChip({ status }: { status: ServerStatus }) {
  const color = status.connected ? 'var(--accent-green)' : 'var(--accent-red)';
  const label = status.connected
    ? status.document || 'Connected'
    : status.error
      ? 'Disconnected'
      : 'Connecting...';
  return (
    <div
      title={status.error ?? status.document ?? ''}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 14,
        background: `${color}20`,
        color,
        fontWeight: 500,
        maxWidth: 260,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }}
      />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </span>
    </div>
  );
}

/**
 * Connection chip for the CostEstDB MCP. Mirrors the AutoCAD chip so the
 * user sees up front whether pricing lookups will resolve. Tooltip surfaces
 * the actual error so a 401 / network issue can be diagnosed without
 * digging into devtools.
 */
function McpStatusChip({ status }: { status: CostEstDbStatus }) {
  const color = status.connected ? 'var(--accent-green)' : 'var(--accent-red)';
  const label = status.connected
    ? `CostEstDB${status.toolCount ? ` · ${status.toolCount} tools` : ''}`
    : status.error
      ? 'CostEstDB offline'
      : 'CostEstDB connecting...';
  const tooltip = status.connected
    ? `Pricing MCP connected${status.url ? ` (${status.url})` : ''}`
    : (status.error ?? 'Connecting to CostEstDB MCP...');
  return (
    <div
      title={tooltip}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 14,
        background: `${color}20`,
        color,
        fontWeight: 500,
        maxWidth: 260,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }}
      />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </span>
    </div>
  );
}
