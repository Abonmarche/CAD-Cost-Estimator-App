import {
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Layers,
  Loader2,
  Ruler,
} from 'lucide-react';

export type WorkflowStep = 'setup' | 'quantify' | 'estimate';

interface Props {
  step: WorkflowStep;
  pendingCount: number;
  itemCount: number;
  flaggedCount: number;
  readyCount: number;
  running: boolean;
  exporting: boolean;
  canAdvance: boolean;
  onAdvance(): void;
  onGoBack(target: WorkflowStep): void;
}

interface StepDef {
  key: WorkflowStep;
  label: string;
  icon: typeof ClipboardList;
}

const STEPS: StepDef[] = [
  { key: 'setup', label: 'Setup', icon: ClipboardList },
  { key: 'quantify', label: 'Quantify', icon: Ruler },
  { key: 'estimate', label: 'Estimate', icon: CircleDollarSign },
];

export function StepperFooter({
  step,
  pendingCount,
  itemCount,
  flaggedCount,
  readyCount,
  running,
  exporting,
  canAdvance,
  onAdvance,
  onGoBack,
}: Props) {
  const activeIndex = STEPS.findIndex((s) => s.key === step);
  const inFlight = running || exporting;
  // The CTA pill is whichever step `onAdvance` will act on:
  //   - On `setup` / `quantify`: the next step's pill is the CTA.
  //   - On `estimate` (last step): the current step's pill is the CTA — the
  //     action IS this step (export). Otherwise no CTA would render at all.
  const ctaIndex =
    activeIndex === STEPS.length - 1 ? activeIndex : activeIndex + 1;
  const summary = buildSummary({
    step,
    itemCount,
    pendingCount,
    flaggedCount,
    readyCount,
    running,
    exporting,
  });

  return (
    <footer className="flex flex-shrink-0 items-center justify-between gap-4 border-t border-cloud bg-white/95 px-6 py-3 backdrop-blur">
      <div className="hidden min-w-0 items-center gap-2 text-sm text-slate sm:flex">
        <Layers className="h-4 w-4 flex-shrink-0" />
        <span className="truncate">{summary}</span>
      </div>

      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => {
          const state =
            i < activeIndex ? 'done' : i === activeIndex ? 'current' : 'next';
          const isCta = i === ctaIndex;
          const Icon = s.icon;

          // The CTA pill — enlarged, navy, clickable. Triggers `onAdvance`,
          // whose action depends on the workflow step (measure on setup,
          // export on estimate).
          if (isCta) {
            return (
              <button
                key={s.key}
                type="button"
                onClick={onAdvance}
                disabled={!canAdvance || inFlight}
                className="inline-flex items-center gap-2 rounded-xl bg-navy px-5 py-3 text-sm font-semibold text-white shadow-card transition-colors hover:bg-sapphire disabled:cursor-not-allowed disabled:bg-cloud disabled:text-slate"
              >
                {inFlight ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
                {ctaLabel(s.key, inFlight)}
                {!inFlight && <ArrowRight className="h-4 w-4" />}
              </button>
            );
          }

          if (state === 'done') {
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => onGoBack(s.key)}
                title={`Back to ${s.label}`}
                className="inline-flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-xs font-medium text-success transition-colors hover:bg-success/15"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {s.label}
              </button>
            );
          }

          if (state === 'current') {
            return (
              <div
                key={s.key}
                className="inline-flex items-center gap-2 rounded-xl bg-cloud px-3 py-2 text-xs font-semibold text-navy"
              >
                {inFlight ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Icon className="h-3.5 w-3.5" />
                )}
                {s.label}
              </div>
            );
          }

          // Future steps (more than one ahead) — disabled placeholder.
          return (
            <div
              key={s.key}
              className="inline-flex items-center gap-2 rounded-xl border border-cloud px-3 py-2 text-xs font-medium text-slate"
            >
              <Icon className="h-3.5 w-3.5" />
              {s.label}
            </div>
          );
        })}
      </div>
    </footer>
  );
}

function ctaLabel(target: WorkflowStep, inFlight: boolean): string {
  if (inFlight) {
    return target === 'quantify' ? 'Measuring…' : 'Exporting…';
  }
  return target === 'quantify' ? 'Quantify' : 'Generate estimate';
}

function buildSummary({
  step,
  itemCount,
  pendingCount,
  flaggedCount,
  readyCount,
  running,
  exporting,
}: {
  step: WorkflowStep;
  itemCount: number;
  pendingCount: number;
  flaggedCount: number;
  readyCount: number;
  running: boolean;
  exporting: boolean;
}): string {
  if (exporting) return 'Saving Excel estimate…';
  if (running) return 'Measuring quantities from AutoCAD…';
  if (itemCount === 0) {
    return 'Add a pay item from the library to begin.';
  }
  const itemLabel = `${itemCount} pay item${itemCount === 1 ? '' : 's'} configured`;
  if (step === 'setup') {
    if (flaggedCount > 0) {
      return `${itemLabel} · ${flaggedCount} item${flaggedCount === 1 ? '' : 's'} need${flaggedCount === 1 ? 's' : ''} more detail before measuring`;
    }
    return `${itemLabel} · ${pendingCount} ready to measure`;
  }
  if (step === 'quantify') {
    if (flaggedCount > 0) {
      return `${flaggedCount} item${flaggedCount === 1 ? '' : 's'} need${flaggedCount === 1 ? 's' : ''} review before continuing`;
    }
    if (pendingCount > 0) {
      return `${pendingCount} item${pendingCount === 1 ? '' : 's'} still pending measurement`;
    }
    return `${readyCount} item${readyCount === 1 ? '' : 's'} ready to estimate`;
  }
  return `${readyCount} item${readyCount === 1 ? '' : 's'} priced · ready to export`;
}
