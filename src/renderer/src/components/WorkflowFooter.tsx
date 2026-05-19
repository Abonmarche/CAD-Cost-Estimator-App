import {
  ArrowRight,
  CircleDollarSign,
  Layers,
  Loader2,
  Plus,
  Ruler,
  Sparkles,
} from 'lucide-react';

/**
 * Single-button workflow footer.
 *
 * The previous version had three clickable pills (Setup / Quantify /
 * Estimate) with a `canAdvance` state machine. That was confusing in
 * practice: clicking Apply on an agent suggestion reset an item to
 * pending, which left the Quantify button disabled because the state
 * machine had already moved past quantification — the only way out was
 * to click the green-checked Setup pill to "go back," which read like
 * decoration rather than a control.
 *
 * The new model: ONE primary button on the right whose label and
 * onClick are derived purely from the current item counts. Whatever
 * needs doing next is what the button does. No state machine, no
 * "go back" affordance, no advance/retreat — just "do the next thing."
 *
 * Status text on the left explains *why* the button shows what it does
 * (especially when it's disabled — e.g. "Resolve 1 flagged item first").
 */

interface Props {
  itemCount: number;
  pendingCount: number;
  flaggedCount: number;
  processingCount: number;
  completeCount: number;
  erroredCount: number;
  running: boolean;
  exporting: boolean;
  onMeasure: () => void;
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
  if (p.exporting) {
    return { label: 'Exporting…', icon: Loader2, onClick: null, spinning: true };
  }
  if (p.itemCount === 0) {
    return { label: 'Add a pay item to begin', icon: Plus, onClick: null };
  }
  // Flagged items need user interaction in the chat panel before they
  // can be measured. Block the primary action so the user looks at the
  // flagged card rather than re-clicking Quantify.
  if (p.flaggedCount > 0) {
    return { label: 'Resolve flagged items first', icon: Sparkles, onClick: null };
  }
  // Anything pending? That's the next thing to do — measure them. This
  // is the path the user hit yesterday: after Applying a suggestion,
  // status flips back to pending, so the button correctly re-offers
  // Quantify.
  if (p.pendingCount > 0) {
    return {
      label: `Quantify ${p.pendingCount} item${p.pendingCount === 1 ? '' : 's'}`,
      icon: Ruler,
      onClick: p.onMeasure,
    };
  }
  // Everything is measured cleanly — ready to price + export.
  if (p.completeCount > 0) {
    return {
      label: 'Generate estimate',
      icon: CircleDollarSign,
      onClick: p.onExport,
    };
  }
  // Everything errored out — nothing to do until the user fixes cards.
  return { label: 'Fix errors to continue', icon: Sparkles, onClick: null };
}

function buildStatus(p: Props): string {
  if (p.running) return 'Measuring quantities from AutoCAD…';
  if (p.exporting) return 'Saving Excel estimate…';
  if (p.itemCount === 0) {
    return 'Add a pay item from the library to begin.';
  }
  if (p.flaggedCount > 0) {
    return `${p.flaggedCount} item${p.flaggedCount === 1 ? '' : 's'} need${p.flaggedCount === 1 ? 's' : ''} review — see the Estimator Assistant on the card above.`;
  }
  if (p.pendingCount > 0) {
    const others = p.completeCount > 0 ? ` · ${p.completeCount} already priced` : '';
    return `${p.pendingCount} item${p.pendingCount === 1 ? '' : 's'} ready to quantify${others}.`;
  }
  if (p.erroredCount === p.itemCount) {
    return `${p.erroredCount} item${p.erroredCount === 1 ? '' : 's'} could not be measured. Adjust the cards above and retry.`;
  }
  return `${p.completeCount} of ${p.itemCount} item${p.itemCount === 1 ? '' : 's'} priced — ready to export.`;
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
