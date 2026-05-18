import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';

import type { PayItemPreset, PresetAccent } from '@shared/types';
import { PRESETS } from '@shared/presets';

interface Props {
  collapsed: boolean;
  onToggle(): void;
  onAdd(preset: PayItemPreset): void;
}

const ACCENT_BORDER: Record<PresetAccent, string> = {
  sky: 'border-l-accent-sky',
  amber: 'border-l-accent-amber',
  slate: 'border-l-accent-slate',
  rose: 'border-l-accent-rose',
  charcoal: 'border-l-accent-charcoal',
  zinc: 'border-l-accent-zinc',
  cloud: 'border-l-accent-cloud',
};

export function PayItemLibrary({ collapsed, onToggle, onAdd }: Props) {
  const [activeKey, setActiveKey] = useState(PRESETS[0].key);
  const [query, setQuery] = useState('');

  const active = PRESETS.find((p) => p.key === activeKey) ?? PRESETS[0];

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return active.items;
    return active.items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.defaultLayer.toLowerCase().includes(q) ||
        i.objectType.toLowerCase().includes(q),
    );
  }, [active.items, query]);

  if (collapsed) {
    return (
      <aside className="flex w-12 flex-shrink-0 flex-col items-center border-r border-cloud bg-white py-3">
        <button
          type="button"
          onClick={onToggle}
          title="Expand pay item library"
          aria-label="Expand pay item library"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate transition-colors hover:bg-cloud hover:text-navy"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  // Pick a sensible custom-add default from the Site/misc category.
  const customAddPreset =
    PRESETS.find((p) => p.key === 'site')?.items[0] ?? active.items[0];

  return (
    <aside className="flex w-[320px] flex-shrink-0 flex-col border-r border-cloud bg-white">
      <div className="flex items-start justify-between gap-2 p-4">
        <div>
          <h2 className="text-sm font-semibold text-charcoal">Pay Item Library</h2>
          <p className="mt-0.5 text-xs text-slate">
            Start from a standard item or create a custom one.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onAdd(customAddPreset)}
            title="Add a custom pay item"
            aria-label="Add a custom pay item"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy text-white shadow-card transition-colors hover:bg-sapphire"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToggle}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate transition-colors hover:bg-cloud hover:text-navy"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="px-4 pb-3">
        <div className="flex h-10 items-center gap-2 rounded-lg border border-cloud bg-light px-3 text-sm text-slate">
          <Search className="h-4 w-4" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search item, layer, or unit"
            className="w-full bg-transparent text-sm text-charcoal outline-none placeholder:text-slate"
          />
        </div>
      </div>

      <div className="px-4 pb-3">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-cloud p-1">
          {PRESETS.map((cat) => (
            <button
              key={cat.key}
              type="button"
              onClick={() => setActiveKey(cat.key)}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                activeKey === cat.key
                  ? 'bg-white text-charcoal shadow-card'
                  : 'text-slate hover:text-charcoal'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="space-y-2">
          {visibleItems.map((item) => {
            const accentClass = item.accent
              ? ACCENT_BORDER[item.accent]
              : ACCENT_BORDER.slate;
            return (
              <button
                key={item.name}
                type="button"
                onClick={() => onAdd(item)}
                className={`w-full rounded-xl border border-cloud border-l-4 bg-white p-3 text-left shadow-card transition-all hover:-translate-y-px hover:border-sapphire/30 hover:shadow-elevated ${accentClass}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-charcoal">
                      {item.name}
                    </div>
                    <div className="mt-1 text-xs text-slate">
                      {labelForObjectType(item.objectType)} ·{' '}
                      {labelForMeasurement(item.measurement)}
                    </div>
                  </div>
                  {item.defaultLayer && (
                    <span className="flex-shrink-0 rounded-md bg-light px-2 py-1 font-mono text-[11px] font-medium text-slate">
                      {item.defaultLayer}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {visibleItems.length === 0 && (
            <div className="px-2 py-6 text-center text-xs text-slate">
              No items match “{query}”.
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function labelForObjectType(t: string): string {
  switch (t) {
    case 'closedPolyline':
      return 'Closed polyline';
    case 'polyline':
      return 'Polyline';
    case 'pipe':
      return 'Pipe';
    case 'hatch':
      return 'Hatch';
    case 'block':
      return 'Block';
    default:
      return t;
  }
}

function labelForMeasurement(m: string): string {
  switch (m) {
    case 'linear':
      return 'LF';
    case 'area':
      return 'SY';
    case 'count':
      return 'EA';
    default:
      return m;
  }
}
