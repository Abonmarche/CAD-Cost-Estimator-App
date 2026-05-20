import { useEffect, useMemo, useState } from 'react';

import type { EstimateExport, FeedbackType } from '@shared/types';

import { AppHeader } from './components/AppHeader';
import { ProjectCard } from './components/ProjectCard';
import { PayItemLibrary } from './components/PayItemLibrary';
import { PayItemList } from './components/PayItemList';
import { EmptyState } from './components/EmptyState';
import { FeedbackModal } from './components/FeedbackModal';
import { WorkflowFooter } from './components/WorkflowFooter';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { SignInScreen } from './auth/SignInScreen';
import { useAutocadStatus } from './hooks/useAutocadStatus';
import { useCostEstDbStatus } from './hooks/useCostEstDbStatus';
import { usePayItems } from './hooks/usePayItems';
import { useEstimate } from './hooks/useEstimate';

const LIBRARY_COLLAPSED_KEY = 'cea.libraryCollapsed';
const SHEET_EXPORT_ENABLED_KEY = 'cea.sheetExportEnabled';
const SHEET_EXPORT_PREFIX_KEY = 'cea.sheetExportPrefix';
const DEFAULT_SHEET_PREFIX = 'Sheet';

export function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

function AppShell() {
  const { state } = useAuth();
  if (state.status !== 'signedIn') return <SignInScreen />;
  return <AppMain />;
}

function AppMain() {
  const [projectName, setProjectName] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState<FeedbackType | null>(null);
  const [libraryCollapsed, setLibraryCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(LIBRARY_COLLAPSED_KEY) === '1';
  });
  const [sheetExportEnabled, setSheetExportEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SHEET_EXPORT_ENABLED_KEY) === '1';
  });
  const [sheetExportPrefix, setSheetExportPrefix] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_SHEET_PREFIX;
    return (
      window.localStorage.getItem(SHEET_EXPORT_PREFIX_KEY) ?? DEFAULT_SHEET_PREFIX
    );
  });

  useEffect(() => {
    window.localStorage.setItem(
      LIBRARY_COLLAPSED_KEY,
      libraryCollapsed ? '1' : '0',
    );
  }, [libraryCollapsed]);
  useEffect(() => {
    window.localStorage.setItem(
      SHEET_EXPORT_ENABLED_KEY,
      sheetExportEnabled ? '1' : '0',
    );
  }, [sheetExportEnabled]);
  useEffect(() => {
    window.localStorage.setItem(SHEET_EXPORT_PREFIX_KEY, sheetExportPrefix);
  }, [sheetExportPrefix]);

  const status = useAutocadStatus();
  const mcpStatus = useCostEstDbStatus();
  const {
    items,
    addItem,
    updateItem,
    removeItem,
    applyUpdate,
    resolveFlag,
    setManualQuantity,
  } = usePayItems();
  const { running, pricing, exporting, measure, priceAll, exportEstimate } =
    useEstimate(items, applyUpdate);

  const counts = useMemo(() => {
    const complete = items.filter((i) => i.status === 'complete').length;
    const flagged = items.filter((i) => i.status === 'flagged').length;
    const pending = items.filter((i) => i.status === 'pending').length;
    const processing = items.filter((i) => i.status === 'processing').length;
    const errored = items.filter((i) => i.status === 'error').length;
    // Items measured but not yet sent through CostEstDB. Drives the
    // "Generate estimate" button — once all complete items have either
    // a price OR a pricingAttempted flag, the workflow advances to
    // Export.
    const priceable = items.filter(
      (i) =>
        i.status === 'complete' &&
        i.unitPrice === null &&
        !i.pricingAttempted,
    ).length;
    const total = items.reduce(
      (sum, i) => sum + (i.quantity ?? 0) * (i.unitPrice ?? 0),
      0,
    );
    return {
      complete,
      flagged,
      pending,
      processing,
      errored,
      priceable,
      total,
    };
  }, [items]);

  async function handleExport() {
    const payload: EstimateExport = {
      projectName,
      items,
      totalCost: counts.total,
      exportDate: new Date().toISOString(),
      sheetExport: {
        enabled: sheetExportEnabled,
        prefix: sheetExportPrefix.trim() || DEFAULT_SHEET_PREFIX,
      },
    };
    const res = await exportEstimate(payload);
    if (res.success) {
      console.info('Saved to', res.filePath);
    } else {
      alert(`Export failed: ${res.error}`);
    }
  }

  return (
    <div className="flex h-full flex-col bg-light text-charcoal">
      <AppHeader
        status={status}
        mcpStatus={mcpStatus}
        onOpenFeedback={setFeedbackOpen}
      />

      {feedbackOpen && (
        <FeedbackModal type={feedbackOpen} onClose={() => setFeedbackOpen(null)} />
      )}

      <div className="flex flex-1 overflow-hidden">
        <PayItemLibrary
          collapsed={libraryCollapsed}
          onToggle={() => setLibraryCollapsed((v) => !v)}
          onAdd={addItem}
        />

        <main className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mx-auto flex max-w-5xl flex-col gap-5">
            <ProjectCard
              projectName={projectName}
              onProjectNameChange={setProjectName}
              stats={{
                items: items.length,
                ready: counts.complete,
                estimate: counts.total,
              }}
              sheetExportEnabled={sheetExportEnabled}
              onSheetExportEnabledChange={setSheetExportEnabled}
              sheetExportPrefix={sheetExportPrefix}
              onSheetExportPrefixChange={setSheetExportPrefix}
            />

            {items.length === 0 ? (
              <EmptyState />
            ) : (
              <PayItemList
                items={items}
                onUpdate={updateItem}
                onRemove={removeItem}
                onResolve={resolveFlag}
                onSetManual={setManualQuantity}
              />
            )}
          </div>
        </main>
      </div>

      <WorkflowFooter
        itemCount={items.length}
        pendingCount={counts.pending}
        flaggedCount={counts.flagged}
        processingCount={counts.processing}
        completeCount={counts.complete}
        priceableCount={counts.priceable}
        erroredCount={counts.errored}
        running={running}
        pricing={pricing}
        exporting={exporting}
        onMeasure={measure}
        onPrice={priceAll}
        onExport={handleExport}
      />
    </div>
  );
}
