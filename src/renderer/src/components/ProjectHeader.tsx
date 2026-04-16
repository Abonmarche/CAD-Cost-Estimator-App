import type { MeasurementType, ServerStatus } from '@shared/types';

interface Stats {
  complete: number;
  flagged: number;
  pending: number;
  total: number;
}

interface Props {
  status: ServerStatus;
  stats: Stats;
  unitLabels: Record<MeasurementType, string>;
}

export function ProjectHeader({ status, stats }: Props) {
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
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            AutoCAD + CostEstDB
          </div>
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
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </div>
  );
}
