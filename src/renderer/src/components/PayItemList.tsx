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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item, i) => (
        <PayItemRow key={item.id} item={item} index={i} {...handlers} />
      ))}
    </div>
  );
}
