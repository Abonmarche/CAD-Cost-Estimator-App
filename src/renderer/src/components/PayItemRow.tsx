import { useState } from 'react';

import type { PayItem, PayItemStatus } from '@shared/types';
import {
  MEASUREMENT_UNITS,
  OBJECT_TYPE_OPTIONS,
} from '@shared/constants';

interface Props {
  item: PayItem;
  index: number;
  onUpdate(id: string, patch: Partial<PayItem>): void;
  onRemove(id: string): void;
  onResolve(id: string, userInput: string): void;
  onSetManual(id: string, quantity: number, notes?: string): void;
}

const STATUS_STYLES: Record<
  PayItemStatus,
  { bg: string; border: string; dot: string; label: string }
> = {
  pending: {
    bg: '#2a2d35',
    border: '#3d414b',
    dot: '#6b7280',
    label: 'Pending',
  },
  processing: {
    bg: '#1e2a3a',
    border: '#2563eb44',
    dot: '#3b82f6',
    label: 'Processing...',
  },
  complete: {
    bg: '#1a2e1a',
    border: '#16a34a44',
    dot: '#22c55e',
    label: 'Complete',
  },
  flagged: {
    bg: '#2e2415',
    border: '#d9770644',
    dot: '#f59e0b',
    label: 'Needs Review',
  },
  error: {
    bg: '#2e1a1a',
    border: '#ef444444',
    dot: '#ef4444',
    label: 'Error',
  },
};

export function PayItemRow({
  item,
  index,
  onUpdate,
  onRemove,
  onResolve,
  onSetManual,
}: Props) {
  const status = STATUS_STYLES[item.status];
  const [manualMode, setManualMode] = useState(false);
  const [manualQty, setManualQty] = useState('');
  const [chatInput, setChatInput] = useState('');

  return (
    <div
      className="row-enter"
      style={{
        background: status.bg,
        borderRadius: 10,
        border: `1px solid ${status.border}`,
        padding: 14,
        transition: 'all 0.2s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'var(--bg-card)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            color: 'var(--text-dim)',
            fontWeight: 600,
            flexShrink: 0,
            marginTop: 2,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {index + 1}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 10,
            }}
          >
            <span style={{ fontSize: 15 }}>{item.icon}</span>
            <input
              value={item.name}
              onChange={(e) => onUpdate(item.id, { name: e.target.value })}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                fontSize: 15,
                fontWeight: 600,
                outline: 'none',
                flex: 1,
                padding: 0,
                minWidth: 0,
              }}
            />
            <StatusBadge dot={status.dot} label={status.label} />
          </div>

          <RowFields item={item} onUpdate={onUpdate} />

          {item.status === 'complete' && item.quantity !== null && (
            <CompleteFooter item={item} />
          )}

          {item.status === 'error' && item.errorMessage && (
            <div
              style={{
                marginTop: 10,
                padding: '8px 12px',
                background: '#ef444412',
                border: '1px solid #ef444422',
                borderRadius: 6,
                color: '#fca5a5',
                fontSize: 12,
              }}
            >
              {item.errorMessage}
            </div>
          )}

          {item.status === 'flagged' && (
            <FlaggedPanel
              item={item}
              manualMode={manualMode}
              setManualMode={setManualMode}
              manualQty={manualQty}
              setManualQty={setManualQty}
              chatInput={chatInput}
              setChatInput={setChatInput}
              onResolve={(text) => onResolve(item.id, text)}
              onSetManual={() => {
                const n = Number(manualQty);
                if (!Number.isFinite(n) || n < 0) return;
                onSetManual(item.id, n);
                setManualMode(false);
                setManualQty('');
              }}
            />
          )}
        </div>

        <button
          onClick={() => onRemove(item.id)}
          title="Remove"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-faint)',
            cursor: 'pointer',
            fontSize: 18,
            padding: 4,
            lineHeight: 1,
            flexShrink: 0,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-red)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-faint)')}
        >
          ×
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ dot, label }: { dot: string; label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 10px',
        borderRadius: 20,
        background: `${dot}18`,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: dot,
        }}
      />
      <span style={{ fontSize: 11, color: dot, fontWeight: 500 }}>{label}</span>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  color: 'var(--text-dim)',
  marginBottom: 3,
  fontWeight: 500,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  background: 'var(--bg-input)',
  border: '1px solid var(--border-card)',
  borderRadius: 6,
  color: 'var(--text-secondary)',
  fontSize: 13,
  outline: 'none',
};

function RowFields({
  item,
  onUpdate,
}: {
  item: PayItem;
  onUpdate: (id: string, patch: Partial<PayItem>) => void;
}) {
  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1.5fr 0.7fr',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div>
          <label style={labelStyle}>Layer</label>
          <input
            value={item.layer}
            onChange={(e) => onUpdate(item.id, { layer: e.target.value })}
            placeholder="e.g. W-MAIN"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Object Type</label>
          <select
            value={item.objectType}
            onChange={(e) =>
              onUpdate(item.id, {
                objectType: e.target.value as PayItem['objectType'],
              })
            }
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            {OBJECT_TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Unit</label>
          <div
            style={{
              ...inputStyle,
              background: 'var(--bg-card)',
              color: 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {MEASUREMENT_UNITS[item.measurement] || '—'}
          </div>
        </div>
      </div>

      {item.fields.includes('autoDiameter') && (
        <div
          style={{
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--text-secondary)',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={item.autoDiameterFromWidth ?? false}
              onChange={(e) =>
                onUpdate(item.id, {
                  autoDiameterFromWidth: e.target.checked,
                })
              }
              style={{ margin: 0, cursor: 'pointer' }}
            />
            Auto-diameter from polyline width
          </label>
          {item.autoDiameterFromWidth &&
            item.diameter &&
            item.status === 'complete' && (
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--text-dim)',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                Detected: {item.diameter}
              </span>
            )}
        </div>
      )}
      {item.fields.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 8,
          }}
        >
          {item.fields.includes('diameter') && !item.autoDiameterFromWidth && (
            <TextField
              label="Diameter"
              value={item.diameter || ''}
              onChange={(v) => onUpdate(item.id, { diameter: v })}
              placeholder='e.g. 8"'
            />
          )}
          {item.fields.includes('material') && (
            <TextField
              label="Material"
              value={item.material || ''}
              onChange={(v) => onUpdate(item.id, { material: v })}
              placeholder="e.g. DIP, PVC"
            />
          )}
          {item.fields.includes('thickness') && (
            <TextField
              label="Thickness"
              value={item.thickness || ''}
              onChange={(v) => onUpdate(item.id, { thickness: v })}
              placeholder='e.g. 3"'
            />
          )}
          {item.fields.includes('type') && (
            <TextField
              label="Type / Spec"
              value={item.spec || ''}
              onChange={(v) => onUpdate(item.id, { spec: v })}
              placeholder="e.g. Type D4"
            />
          )}
          {item.fields.includes('size') && (
            <TextField
              label="Size"
              value={item.size || ''}
              onChange={(v) => onUpdate(item.id, { size: v })}
              placeholder='e.g. 8"'
            />
          )}
          {item.fields.includes('depth') && (
            <TextField
              label="Depth"
              value={item.depth || ''}
              onChange={(v) => onUpdate(item.id, { depth: v })}
              placeholder="e.g. 8'"
            />
          )}
          {item.fields.includes('course') && (
            <TextField
              label="Course"
              value={item.course || ''}
              onChange={(v) => onUpdate(item.id, { course: v })}
              placeholder="e.g. Top, Leveling"
            />
          )}
        </div>
      )}
    </>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
    </div>
  );
}

function CompleteFooter({ item }: { item: PayItem }) {
  const unit = MEASUREMENT_UNITS[item.measurement];
  return (
    <div
      style={{
        marginTop: 10,
        padding: '9px 12px',
        background: '#16a34a14',
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
      }}
    >
      <span
        style={{
          color: '#86efac',
          fontSize: 13,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        Qty: {item.quantity?.toLocaleString()} {unit}
      </span>
      <span
        style={{
          color: '#86efac',
          fontSize: 13,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {item.unitPrice !== null ? (
          <>
            ${item.unitPrice.toFixed(2)}/{unit} →{' '}
            <strong>${(item.quantity! * item.unitPrice).toLocaleString()}</strong>
          </>
        ) : (
          <span style={{ color: '#fbbf24' }}>No unit price yet</span>
        )}
      </span>
      {item.priceSource && (
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-dim)',
            width: '100%',
          }}
        >
          Source: {item.priceSource}
        </span>
      )}
    </div>
  );
}

function FlaggedPanel({
  item,
  manualMode,
  setManualMode,
  manualQty,
  setManualQty,
  chatInput,
  setChatInput,
  onResolve,
  onSetManual,
}: {
  item: PayItem;
  manualMode: boolean;
  setManualMode: (b: boolean) => void;
  manualQty: string;
  setManualQty: (v: string) => void;
  chatInput: string;
  setChatInput: (v: string) => void;
  onResolve: (text: string) => void;
  onSetManual: () => void;
}) {
  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          padding: '10px 12px',
          background: '#f59e0b10',
          borderRadius: 8,
          border: '1px solid #f59e0b22',
          marginBottom: 8,
        }}
      >
        <div
          style={{
            color: '#fbbf24',
            fontSize: 13,
            fontWeight: 500,
            marginBottom: 4,
          }}
        >
          Estimator Assistant
        </div>
        <div
          style={{
            color: '#d4a054',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {item.flagMessage}
        </div>
        {!manualMode && item.flagOptions && item.flagOptions.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 6,
              marginTop: 10,
              flexWrap: 'wrap',
            }}
          >
            {item.flagOptions.map((opt) => (
              <button
                key={opt}
                onClick={() => {
                  if (/set quantity manually/i.test(opt)) {
                    setManualMode(true);
                  } else {
                    onResolve(opt);
                  }
                }}
                style={{
                  padding: '5px 12px',
                  borderRadius: 6,
                  border: '1px solid #f59e0b44',
                  background: '#f59e0b11',
                  color: '#fbbf24',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontWeight: 500,
                  transition: 'all 0.12s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#f59e0b22';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#f59e0b11';
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>
      {manualMode ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            placeholder="Enter quantity"
            value={manualQty}
            onChange={(e) => setManualQty(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={onSetManual}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #22c55e44',
              background: '#22c55e15',
              color: 'var(--accent-green)',
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Set
          </button>
          <button
            onClick={() => setManualMode(false)}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid var(--border-card)',
              background: 'transparent',
              color: 'var(--text-dim)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            placeholder="Or type a response to the Estimator Assistant..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && chatInput.trim()) {
                onResolve(chatInput.trim());
                setChatInput('');
              }
            }}
            style={{ ...inputStyle, flex: 1 }}
          />
        </div>
      )}
    </div>
  );
}
