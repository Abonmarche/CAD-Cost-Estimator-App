import { ClipboardList } from 'lucide-react';

import type { PayItem } from '@shared/types';

import { PayItemRow } from './PayItemRow';

interface Props {
  items: PayItem[];
  onUpdate(id: string, patch: Partial<PayItem>): void;
  onRemove(id: string): void;
  onResolve(id: string, userInput: string): void;
  onSetManual(id: string, quantity: number, notes?: string): void;
}

export function PayItemList(props: Props) {
  const { items, ...handlers } = props;
  return (
    <section className="card">
      <div className="flex items-center justify-between gap-4 border-b border-cloud px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-charcoal">Quantity Setup</h2>
          <p className="mt-0.5 text-xs text-slate">
            Confirm layers, geometry type, units, and required estimating attributes.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          title="Review Abonmarche pay item standards"
        >
          <ClipboardList className="h-4 w-4" />
          Review standards
        </button>
      </div>
      <div className="divide-y divide-cloud">
        {items.map((item, i) => (
          <PayItemRow key={item.id} item={item} index={i} {...handlers} />
        ))}
      </div>
    </section>
  );
}
