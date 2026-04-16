export function EmptyState() {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '56px 20px',
        color: 'var(--text-faint)',
      }}
    >
      <div style={{ fontSize: 36, marginBottom: 10 }}>📐</div>
      <div style={{ fontSize: 14, color: 'var(--text-dim)' }}>
        Add pay items from the picker above to get started
      </div>
      <div style={{ fontSize: 12, marginTop: 4 }}>
        Items will be measured from your open AutoCAD drawing
      </div>
    </div>
  );
}
