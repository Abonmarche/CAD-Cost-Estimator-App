interface Stats {
  items: number;
  ready: number;
  estimate: number;
}

interface Props {
  projectName: string;
  onProjectNameChange(value: string): void;
  stats: Stats;
  sheetExportEnabled: boolean;
  onSheetExportEnabledChange(value: boolean): void;
  sheetExportPrefix: string;
  onSheetExportPrefixChange(value: string): void;
}

export function ProjectCard({
  projectName,
  onProjectNameChange,
  stats,
  sheetExportEnabled,
  onSheetExportEnabledChange,
  sheetExportPrefix,
  onSheetExportPrefixChange,
}: Props) {
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

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-cloud pt-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sheetExportEnabled}
            onChange={(e) => onSheetExportEnabledChange(e.target.checked)}
            className="h-4 w-4 rounded border-cloud text-navy focus:ring-2 focus:ring-sapphire/30"
          />
          <span className="font-medium text-charcoal">
            Break down export by plan sheet
          </span>
          <span
            className="text-xs text-slate"
            title="Michigan workflow. Looks for closed polylines on layers named with this prefix followed by a number (e.g. Sheet1, Sheet2). Each polygon defines one plan sheet's boundary; the export gets one extra worksheet per sheet."
          >
            (Michigan)
          </span>
        </label>
        {sheetExportEnabled && (
          <div className="flex items-center gap-2">
            <label
              htmlFor="sheet-prefix"
              className="text-xs font-medium uppercase tracking-wide text-slate"
            >
              Sheet layer prefix
            </label>
            <input
              id="sheet-prefix"
              type="text"
              value={sheetExportPrefix}
              onChange={(e) => onSheetExportPrefixChange(e.target.value)}
              placeholder="Sheet"
              className="h-8 w-32 rounded-md border border-cloud bg-white px-2 text-sm text-charcoal outline-none transition-colors focus:border-sapphire focus:ring-2 focus:ring-sapphire/30"
            />
          </div>
        )}
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
