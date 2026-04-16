interface Props {
  pendingCount: number;
  hasComplete: boolean;
  running: boolean;
  exporting: boolean;
  disabledMeasure: boolean;
  disabledExport: boolean;
  onMeasure(): void;
  onExport(): void;
  onStartOver(): void;
}

export function ActionBar({
  pendingCount,
  hasComplete,
  running,
  exporting,
  disabledMeasure,
  disabledExport,
  onMeasure,
  onExport,
  onStartOver,
}: Props) {
  const measureLabel = running
    ? 'Measuring...'
    : pendingCount === 0
      ? 'All items processed'
      : `Measure ${pendingCount} Pay Item${pendingCount === 1 ? '' : 's'}`;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '12px 24px',
        background: '#13151bee',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex',
        justifyContent: 'center',
        gap: 10,
        backdropFilter: 'blur(12px)',
      }}
    >
      <button
        onClick={onMeasure}
        disabled={disabledMeasure}
        style={{
          padding: '10px 28px',
          borderRadius: 8,
          border: 'none',
          background: running
            ? '#1e3a5f'
            : disabledMeasure
              ? 'var(--bg-card-hover)'
              : 'linear-gradient(135deg, var(--accent-blue-strong), #1d4ed8)',
          color: running
            ? '#60a5fa'
            : disabledMeasure
              ? 'var(--text-faint)'
              : '#fff',
          fontSize: 14,
          fontWeight: 600,
          cursor: disabledMeasure ? 'not-allowed' : running ? 'wait' : 'pointer',
          transition: 'all 0.15s',
        }}
      >
        {measureLabel}
      </button>
      {hasComplete && (
        <button
          onClick={onExport}
          disabled={disabledExport}
          style={{
            padding: '10px 28px',
            borderRadius: 8,
            border: '1px solid #22c55e44',
            background: disabledExport ? '#22c55e09' : '#22c55e15',
            color: disabledExport ? '#16a34a99' : 'var(--accent-green)',
            fontSize: 14,
            fontWeight: 600,
            cursor: disabledExport ? 'not-allowed' : 'pointer',
          }}
        >
          {exporting ? 'Saving...' : 'Export to Excel'}
        </button>
      )}
      <button
        onClick={onStartOver}
        disabled={running}
        style={{
          padding: '10px 20px',
          borderRadius: 8,
          border: '1px solid var(--border-card)',
          background: 'transparent',
          color: 'var(--text-dim)',
          fontSize: 13,
          fontWeight: 500,
          cursor: running ? 'not-allowed' : 'pointer',
        }}
      >
        Start Over
      </button>
    </div>
  );
}
