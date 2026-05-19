import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';

import type { PayItem, PayItemStatus, PresetAccent } from '@shared/types';
import {
  MEASUREMENT_UNITS,
  OBJECT_TYPE_OPTIONS,
} from '@shared/constants';

import { AssistantMarkdown } from './AssistantMarkdown';

interface Props {
  item: PayItem;
  index: number;
  onUpdate(id: string, patch: Partial<PayItem>): void;
  onRemove(id: string): void;
  onResolve(id: string, userInput: string): void;
  onSetManual(id: string, quantity: number, notes?: string): void;
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

export function PayItemRow({
  item,
  index,
  onUpdate,
  onRemove,
  onResolve,
  onSetManual,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualQty, setManualQty] = useState('');
  const [chatInput, setChatInput] = useState('');

  const accentClass = item.accent
    ? ACCENT_BORDER[item.accent]
    : ACCENT_BORDER.slate;

  const method = methodLine(item.measurement);
  const unit = MEASUREMENT_UNITS[item.measurement];

  return (
    <article
      className={`row-enter border-l-4 p-5 ${accentClass}`}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-cloud text-sm font-semibold text-slate">
            {index + 1}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={item.name}
                onChange={(e) => onUpdate(item.id, { name: e.target.value })}
                className="min-w-0 max-w-full border-0 bg-transparent p-0 text-base font-semibold tracking-tight text-charcoal outline-none focus:ring-0"
              />
              <StatusPill status={item.status} />
            </div>
            <p className="mt-1 text-sm text-slate">{method}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          aria-label="Remove pay item"
          title="Remove"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-slate transition-colors hover:bg-cloud hover:text-danger"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FieldInput
          label="CAD layer"
          value={item.layer}
          onChange={(v) => onUpdate(item.id, { layer: v })}
          placeholder="e.g. W-MAIN"
          mono
        />
        <FieldSelect
          label="Object type"
          value={item.objectType}
          onChange={(v) =>
            onUpdate(item.id, {
              objectType: v as PayItem['objectType'],
            })
          }
          options={OBJECT_TYPE_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
          }))}
        />
        <FieldReadOnly label="Quantity unit" value={unit || '—'} mono />
        <FieldReadOnly label="Source" value="Current drawing" />
      </div>

      {(item.extraLayers && item.extraLayers.length > 0) && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {item.extraLayers.map((name, i) => (
            <FieldInput
              key={i}
              label={`Layer ${i + 2}`}
              value={name}
              onChange={(v) => {
                const next = [...(item.extraLayers ?? [])];
                next[i] = v;
                onUpdate(item.id, { extraLayers: next });
              }}
              placeholder={i === 0 ? 'e.g. W-MAIN-EX' : ''}
              mono
            />
          ))}
        </div>
      )}

      <AttributeChips item={item} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />

      {expanded && (
        <div className="mt-4 rounded-xl border border-cloud bg-light p-4">
          <ExpandedFields item={item} onUpdate={onUpdate} />
        </div>
      )}

      {item.status === 'complete' && item.quantity !== null && (
        <CompleteFooter item={item} />
      )}

      {item.status === 'error' && item.errorMessage && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{item.errorMessage}</span>
        </div>
      )}

      {/* Keep the Estimator Assistant panel mounted across the flagged →
          processing transition so the user sees their prior context plus
          a "thinking" indicator while the agent works, instead of the
          panel disappearing entirely. Reappears on the eventual error or
          stays visible until status flips to 'complete'. */}
      {(item.status === 'flagged' ||
        (item.status === 'processing' && item.flagMessage)) && (
        <FlaggedPanel
          item={item}
          working={item.status === 'processing'}
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
    </article>
  );
}

function methodLine(m: PayItem['measurement']): string {
  switch (m) {
    case 'linear':
      return 'Length from selected polylines';
    case 'area':
      return 'Area converted to square yards';
    case 'count':
      return 'Count selected objects';
    default:
      return '';
  }
}

function StatusPill({ status }: { status: PayItemStatus }) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <span
      className={`chip ring-1 ${config.className}`}
    >
      <Icon className={`h-3.5 w-3.5 ${config.iconClass ?? ''}`} />
      {config.label}
    </span>
  );
}

const STATUS_CONFIG: Record<
  PayItemStatus,
  {
    label: string;
    icon: typeof CheckCircle2;
    iconClass?: string;
    className: string;
  }
> = {
  pending: {
    label: 'Pending',
    icon: AlertCircle,
    className: 'bg-cloud text-slate ring-cloud',
  },
  processing: {
    label: 'Measuring…',
    icon: Loader2,
    iconClass: 'animate-spin',
    className: 'bg-sapphire/10 text-sapphire ring-sapphire/30',
  },
  complete: {
    label: 'Ready',
    icon: CheckCircle2,
    className: 'bg-success/10 text-success ring-success/30',
  },
  flagged: {
    label: 'Needs details',
    icon: AlertCircle,
    className: 'bg-amber-50 text-amber-600 ring-amber/30',
  },
  error: {
    label: 'Error',
    icon: AlertCircle,
    className: 'bg-danger/10 text-danger ring-danger/30',
  },
};

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`field-input ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field-input cursor-pointer pr-8"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function FieldReadOnly({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <div
        className={`field-input flex items-center bg-light text-slate ${
          mono ? 'font-mono' : ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Attribute chips below the field grid. Required-but-missing attributes
 * show in amber; filled attributes show as neutral pills. Clicking the
 * "more attributes" chip expands the row into a detail editor.
 */
function AttributeChips({
  item,
  expanded,
  onToggle,
}: {
  item: PayItem;
  expanded: boolean;
  onToggle(): void;
}) {
  const chips = buildAttributeChips(item);
  if (chips.length === 0 && !item.fields.length) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <span
          key={chip.label}
          className={`chip ring-1 ${
            chip.missing
              ? 'bg-amber-50 text-amber-600 ring-amber/30'
              : 'bg-light text-slate ring-cloud'
          }`}
        >
          {chip.label}
        </span>
      ))}
      {item.fields.length > 0 && (
        <button
          type="button"
          onClick={onToggle}
          className="ml-auto text-xs font-medium text-sapphire transition-colors hover:text-navy"
        >
          {expanded ? 'Hide attributes' : 'Edit attributes'}
        </button>
      )}
    </div>
  );
}

function buildAttributeChips(item: PayItem): Array<{
  label: string;
  missing: boolean;
}> {
  const chips: Array<{ label: string; missing: boolean }> = [];
  if (item.fields.includes('autoDiameter')) {
    chips.push({
      label: item.autoDiameterFromWidth
        ? 'Auto diameter from width'
        : 'Manual diameter',
      missing: false,
    });
  }
  if (item.fields.includes('diameter') && !item.autoDiameterFromWidth) {
    chips.push({
      label: item.diameter ? `Diameter: ${item.diameter}` : 'Diameter required',
      missing: !item.diameter,
    });
  }
  if (item.fields.includes('material')) {
    chips.push({
      label: item.material ? `Material: ${item.material}` : 'Material: DIP or PVC',
      missing: !item.material,
    });
  }
  if (item.fields.includes('thickness')) {
    chips.push({
      label: item.thickness ? `Thickness: ${item.thickness}` : 'Thickness required',
      missing: !item.thickness,
    });
  }
  if (item.fields.includes('type')) {
    chips.push({
      label: item.spec ? `Type: ${item.spec}` : 'Type/spec required',
      missing: !item.spec,
    });
  }
  if (item.fields.includes('size')) {
    chips.push({
      label: item.size ? `Size: ${item.size}` : 'Size required',
      missing: !item.size,
    });
  }
  if (item.fields.includes('depth')) {
    chips.push({
      label: item.depth ? `Depth: ${item.depth}` : 'Depth required',
      missing: !item.depth,
    });
  }
  if (item.fields.includes('course')) {
    chips.push({
      label: item.course ? `Course: ${item.course}` : 'Course required',
      missing: !item.course,
    });
  }
  return chips;
}

function ExpandedFields({
  item,
  onUpdate,
}: {
  item: PayItem;
  onUpdate: (id: string, patch: Partial<PayItem>) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {item.fields.includes('autoDiameter') && (
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-charcoal">
          <input
            type="checkbox"
            checked={item.autoDiameterFromWidth ?? false}
            onChange={(e) =>
              onUpdate(item.id, { autoDiameterFromWidth: e.target.checked })
            }
            className="h-4 w-4 rounded border-cloud text-sapphire focus:ring-sapphire/30"
          />
          Auto-diameter from polyline width
        </label>
      )}
      {item.fields.includes('diameter') && !item.autoDiameterFromWidth && (
        <FieldInput
          label="Diameter"
          value={item.diameter || ''}
          onChange={(v) => onUpdate(item.id, { diameter: v })}
          placeholder='e.g. 8"'
        />
      )}
      {item.fields.includes('material') && (
        <FieldInput
          label="Material"
          value={item.material || ''}
          onChange={(v) => onUpdate(item.id, { material: v })}
          placeholder="e.g. DIP, PVC"
        />
      )}
      {item.fields.includes('thickness') && (
        <FieldInput
          label="Thickness"
          value={item.thickness || ''}
          onChange={(v) => onUpdate(item.id, { thickness: v })}
          placeholder='e.g. 3"'
        />
      )}
      {item.fields.includes('type') && (
        <FieldInput
          label="Type / Spec"
          value={item.spec || ''}
          onChange={(v) => onUpdate(item.id, { spec: v })}
          placeholder="e.g. Type D4"
        />
      )}
      {item.fields.includes('size') && (
        <FieldInput
          label="Size"
          value={item.size || ''}
          onChange={(v) => onUpdate(item.id, { size: v })}
          placeholder='e.g. 8"'
        />
      )}
      {item.fields.includes('depth') && (
        <FieldInput
          label="Depth"
          value={item.depth || ''}
          onChange={(v) => onUpdate(item.id, { depth: v })}
          placeholder="e.g. 8'"
        />
      )}
      {item.fields.includes('course') && (
        <FieldInput
          label="Course"
          value={item.course || ''}
          onChange={(v) => onUpdate(item.id, { course: v })}
          placeholder="e.g. Top, Leveling"
        />
      )}
    </div>
  );
}

function CompleteFooter({ item }: { item: PayItem }) {
  const unit = MEASUREMENT_UNITS[item.measurement];
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success/30 bg-success/10 px-4 py-3">
      <span className="font-mono text-sm text-success">
        Qty: {item.quantity?.toLocaleString()} {unit}
      </span>
      <span className="font-mono text-sm text-success">
        {item.unitPrice !== null ? (
          <>
            ${item.unitPrice.toFixed(2)}/{unit} →{' '}
            <strong>
              ${(item.quantity! * item.unitPrice).toLocaleString()}
            </strong>
          </>
        ) : (
          <span className="text-amber-600">No unit price yet</span>
        )}
      </span>
      {item.priceSource && (
        <span className="w-full text-[11px] text-slate">
          Source: {item.priceSource}
        </span>
      )}
    </div>
  );
}

function FlaggedPanel({
  item,
  working,
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
  working: boolean;
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
    <div className="mt-4 overflow-hidden rounded-xl border border-amber/30 bg-amber-50">
      <div className="flex items-center gap-2 bg-sapphire px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white">
        {working ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        Estimator Assistant
        {working && <span className="ml-2 normal-case text-white/80">working…</span>}
      </div>
      <div className="space-y-3 p-4">
        <AssistantMarkdown source={item.flagMessage} />

        {working ? (
          // Resolution is in flight. Keep the panel visible so the user
          // doesn't lose context, but disable the controls and show what
          // the assistant is doing instead of the quick-pick buttons.
          <div className="flex items-center gap-2 rounded-lg border border-amber-600/20 bg-white px-3 py-2 text-sm text-slate">
            <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-sapphire" />
            <span>Estimator Assistant is thinking — checking layers and pricing data…</span>
          </div>
        ) : (
          <>
            {!manualMode && item.flagOptions && item.flagOptions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {item.flagOptions.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      if (/set quantity manually/i.test(opt)) {
                        setManualMode(true);
                      } else {
                        onResolve(opt);
                      }
                    }}
                    className="chip border border-amber-600/30 bg-white text-amber-600 transition-colors hover:bg-amber-50"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
            {manualMode ? (
              <div className="flex flex-wrap gap-2">
                <input
                  value={manualQty}
                  onChange={(e) => setManualQty(e.target.value)}
                  placeholder="Enter quantity"
                  className="field-input flex-1"
                />
                <button
                  type="button"
                  onClick={onSetManual}
                  className="btn-primary"
                >
                  Set
                </button>
                <button
                  type="button"
                  onClick={() => setManualMode(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && chatInput.trim()) {
                    onResolve(chatInput.trim());
                    setChatInput('');
                  }
                }}
                placeholder="Or type a response to the Estimator Assistant…"
                className="field-input"
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
