import { Layers } from 'lucide-react';

export function EmptyState() {
  return (
    <section className="card flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-cloud text-sapphire">
        <Layers className="h-6 w-6" />
      </div>
      <h2 className="text-base font-semibold text-charcoal">No pay items yet</h2>
      <p className="mt-1 max-w-sm text-sm text-slate">
        Pick a standard item from the library on the left or add a custom one. Items will be measured against your open AutoCAD drawing.
      </p>
    </section>
  );
}
