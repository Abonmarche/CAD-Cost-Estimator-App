import {
  ArrowRight,
  CircleDollarSign,
  Download,
  Layers,
  Loader2,
  Plus,
  Ruler,
  Sparkles,
} from 'lucide-react';

/**
 * Single-button workflow footer.
 *
 * The button label + onClick are derived purely from the current item
 * counts — there's no state machine, no "go back" affordance, no
 * advance/retreat. Whatever needs doing next is what the button does.
 *
 * The workflow has three discrete user-driven steps:
 *
 *   Quantify         — runs measurement against the AutoCAD drawing.
 *   Generate estimate— runs CostEstDB price lookups on measured items.
 *   Export           — writes the Excel file.
 *
 * Each step is a separate button press, with its own loading state and
 * status text. Earlier versions chained quantify → price automatically
 * inside the same click, which made "Generate estimate" feel meaningless
 * (the work was already done by the time you saw it).
 */

interface Props {
  itemCount: number;
  pendingCount: number;
  flaggedCount: number;
  processingCount: number;
  completeCount: number;
  /**
   * Items that are 'complete' (measured) but haven't been through
   * CostEstDB yet (no unitPrice AND no pricingAttempted). When > 0 the
   * button offers "Generate estimate"; when 0 (and at least one item is
   * complete) it offers "Export".
   */
  priceableCount: number;
  erroredCount: number;
  running: boolean;
  pricing: boolean;
  exporting: boolean;
  onMeasure: () => void;
  onPrice: () => void;
  onExport: () => void;
}

interface Action {
  label: string;
  icon: typeof Ruler;
  onClick: (() => void) | null;
  spinning?: boolean;
}

function chooseAction(p: Props): Action {
  if (p.running) {
    return { label: 'Measuring…', icon: Loader2, onClick: null, spinning: true };
  }
  if (p.pricing) {
    return { label: 'Looking up prices…', icon: Loader2, onClick: null, spinning: true };
  }
  if (p.exporting) {
    return { label: 'Exporting…', icon: Loader2, onClick: null, spinning: true };
  }
  if (p.itemCount === 0) {
    return { label: 'Add a pay item to begin', icon: Plus, onClick: null };
  }
  // Flagged items need user interaction in the chat panel before they
  // can be measured. Block the primary action so the user looks at the
  // flagged card rather than re-clicking.
  if (p.flaggedCount > 0) {
    return { label: 'Resolve flagged items first', icon: Sparkles, onClick: null };
  }
  // Step 1: any item still needs measuring.
  if (p.pendingCount > 0) {
    return {
      label: `Quantify ${p.pendingCount} item${p.pendingCount === 1 ? '' : 's'}`,
      icon: Ruler,
      onClick: p.onMeasure,
    };
  }
  // Step 2: everything measured, but at least one item hasn't had a
  // pricing lookup yet.
  if (p.priceableCount > 0) {
    return {
      label: 'Generate estimate',
      icon: CircleDollarSign,
      onClick: p.onPrice,
    };
  }
  // Step 3: everything measured AND pricing has been attempted on each
  // item. Ready to write the Excel.
  if (p.completeCount > 0) {
    return {
      label: 'Export',
      icon: Download,
      onClick: p.onExport,
    };
  }
  return { label: 'Fix errors to continue', icon: Sparkles, onClick: null };
}

function buildStatus(p: Props): string {
  if (p.running) return 'Measuring quantities from AutoCAD…';
  if (p.pricing) return 'Querying CostEstDB for unit prices…';
  if (p.exporting) return 'Saving Excel estimate…';
  if (p.itemCount === 0) {
    return 'Add a pay item from the library to begin.';
  }
  if (p.flaggedCount > 0) {
    return `${p.flaggedCount} item${p.flaggedCount === 1 ? '' : 's'} need${p.flaggedCount === 1 ? 's' : ''} review — see the Estimator Assistant on the card above.`;
  }
  if (p.pendingCount > 0) {
    const measured = p.completeCount > 0 ? ` · ${p.completeCount} already measured` : '';
    return `${p.pendingCount} item${p.pendingCount === 1 ? '' : 's'} ready to quantify${measured}.`;
  }
  if (p.priceableCount > 0) {
    return `${p.completeCount} item${p.completeCount === 1 ? '' : 's'} measured — ready to price.`;
  }
  if (p.erroredCount === p.itemCount) {
    return `${p.erroredCount} item${p.erroredCount === 1 ? '' : 's'} could not be measured. Adjust the cards above and retry.`;
  }
  if (p.completeCount > 0) {
    return `${p.completeCount} item${p.completeCount === 1 ? '' : 's'} priced — ready to export.`;
  }
  return '';
}

export function WorkflowFooter(props: Props) {
  const action = chooseAction(props);
  const status = buildStatus(props);
  const Icon = action.icon;
  const enabled = action.onClick !== null;

  return (
    <footer className="flex flex-shrink-0 items-center justify-between gap-4 border-t border-cloud bg-white/95 px-6 py-3 backdrop-blur">
      <div className="hidden min-w-0 items-center gap-2 text-sm text-slate sm:flex">
        <Layers className="h-4 w-4 flex-shrink-0" />
        <span className="truncate">{status}</span>
      </div>

      <button
        type="button"
        onClick={action.onClick ?? undefined}
        disabled={!enabled}
        className="inline-flex items-center gap-2 rounded-xl bg-navy px-5 py-3 text-sm font-semibold text-white shadow-card transition-colors hover:bg-sapphire focus:outline-none focus:ring-2 focus:ring-sapphire/40 disabled:cursor-not-allowed disabled:bg-cloud disabled:text-slate"
      >
        <Icon
          className={`h-4 w-4 ${action.spinning ? 'animate-spin' : ''}`}
        />
        {action.label}
        {enabled && !action.spinning && <ArrowRight className="h-4 w-4" />}
      </button>
    </footer>
  );
}
