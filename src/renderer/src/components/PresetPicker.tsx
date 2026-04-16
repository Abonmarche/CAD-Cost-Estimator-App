import { useState } from 'react';

import type { PayItemPreset } from '@shared/types';
import { PRESETS } from '@shared/presets';

interface Props {
  onAdd(preset: PayItemPreset): void;
  onCollapse?(): void;
}

export function PresetPicker({ onAdd, onCollapse }: Props) {
  const [activeKey, setActiveKey] = useState(PRESETS[0].key);
  const active = PRESETS.find((p) => p.key === activeKey) ?? PRESETS[0];

  return (
    <section style={{ marginBottom: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-dim)',
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          Add Pay Items
        </span>
        {onCollapse && (
          <button
            onClick={onCollapse}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent-blue)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Collapse picker ↑
          </button>
        )}
      </div>
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 12,
          border: '1px solid var(--border-card)',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-card)' }}>
          {PRESETS.map((cat) => (
            <button
              key={cat.key}
              onClick={() => setActiveKey(cat.key)}
              style={{
                flex: 1,
                padding: '11px 8px',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: '0.02em',
                background:
                  activeKey === cat.key ? 'var(--bg-card-hover)' : 'transparent',
                color:
                  activeKey === cat.key
                    ? 'var(--text-primary)'
                    : 'var(--text-dim)',
                borderBottom:
                  activeKey === cat.key
                    ? '2px solid var(--accent-blue)'
                    : '2px solid transparent',
                transition: 'all 0.15s ease',
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>
        <div
          style={{
            padding: 12,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 6,
          }}
        >
          {active.items.map((item) => (
            <button
              key={item.name}
              onClick={() => onAdd(item)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                background: 'var(--bg-card-hover)',
                border: '1px solid var(--border-card)',
                borderRadius: 8,
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                fontSize: 13,
                textAlign: 'left',
                transition: 'all 0.12s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#2d3040';
                e.currentTarget.style.borderColor = 'var(--accent-blue)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-card-hover)';
                e.currentTarget.style.borderColor = 'var(--border-card)';
              }}
            >
              <span
                style={{
                  fontSize: 16,
                  width: 24,
                  textAlign: 'center',
                  flexShrink: 0,
                }}
              >
                {item.icon}
              </span>
              <div>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{item.name}</div>
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--text-dim)',
                    marginTop: 1,
                  }}
                >
                  {item.objectType === 'closedPolyline'
                    ? 'closed polyline'
                    : item.objectType}{' '}
                  · {item.measurement}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
