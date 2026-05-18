interface Stats {
  items: number;
  ready: number;
  estimate: number;
}

interface Props {
  projectName: string;
  onProjectNameChange(value: string): void;
  stats: Stats;
}

export function ProjectCard({ projectName, onProjectNameChange, stats }: Props) {
  return (
    <section className="card p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <label htmlFor="project-name" className="field-label">
            Project
          </label>
          <input
            id="project-name"
            value={projectName}
            onChange={(e) => onProjectNameChange(e.target.value)}
            placeholder="Demorrow Road Reconstruction"
            className="h-12 w-full rounded-xl border border-cloud bg-white px-4 text-base font-medium text-charcoal shadow-card outline-none transition-colors placeholder:text-slate-400 focus:border-sapphire focus:ring-2 focus:ring-sapphire/30"
          />
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <KpiTile label="Items" value={stats.items.toLocaleString()} />
          <KpiTile label="Ready" value={stats.ready.toLocaleString()} />
          <KpiTile
            label="Estimate"
            value={`$${stats.estimate.toLocaleString()}`}
          />
        </div>
      </div>
    </section>
  );
}

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-cloud bg-light px-5 py-3">
      <div className="text-lg font-semibold text-navy">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate">{label}</div>
    </div>
  );
}
