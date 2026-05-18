import { useEffect, useMemo, useState } from 'react';

import type { EstimateExport, FeedbackType } from '@shared/types';

import { AppHeader } from './components/AppHeader';
import { ProjectCard } from './components/ProjectCard';
import { PayItemLibrary } from './components/PayItemLibrary';
import { PayItemList } from './components/PayItemList';
import { EmptyState } from './components/EmptyState';
import { FeedbackModal } from './components/FeedbackModal';
import { StepperFooter, type WorkflowStep } from './components/StepperFooter';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { SignInScreen } from './auth/SignInScreen';
import { useAutocadStatus } from './hooks/useAutocadStatus';
import { useCostEstDbStatus } from './hooks/useCostEstDbStatus';
import { usePayItems } from './hooks/usePayItems';
import { useEstimate } from './hooks/useEstimate';

const LIBRARY_COLLAPSED_KEY = 'cea.libraryCollapsed';

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
  const [hasMeasured, setHasMeasured] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(
      LIBRARY_COLLAPSED_KEY,
      libraryCollapsed ? '1' : '0',
    );
  }, [libraryCollapsed]);

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
  const { running, exporting, measure, exportEstimate } = useEstimate(
    items,
    applyUpdate,
  );

  const counts = useMemo(() => {
    const complete = items.filter((i) => i.status === 'complete').length;
    const flagged = items.filter((i) => i.status === 'flagged').length;
    const pending = items.filter((i) => i.status === 'pending').length;
    const processing = items.filter((i) => i.status === 'processing').length;
    const errored = items.filter((i) => i.status === 'error').length;
    const total = items.reduce(
      (sum, i) => sum + (i.quantity ?? 0) * (i.unitPrice ?? 0),
      0,
    );
    const ready = complete;
    return {
      complete,
      flagged,
      pending,
      processing,
      errored,
      ready,
      total,
    };
  }, [items]);

  // Workflow step derivation. The user clicks the "Quantify" CTA which
  // sets `hasMeasured = true`; from then on we sit in `quantify` until
  // every item is `complete` (or errored), at which point we advance to
  // `estimate`. Going back is handled by `handleGoBack` below.
  const step: WorkflowStep = useMemo(() => {
    if (!hasMeasured) return 'setup';
    if (
      items.length > 0 &&
      counts.complete + counts.errored === items.length &&
      counts.complete > 0
    ) {
      return 'estimate';
    }
    return 'quantify';
  }, [
    hasMeasured,
    items.length,
    counts.complete,
    counts.errored,
  ]);

  // Reset the `hasMeasured` flag when the item set empties (back to setup).
  useEffect(() => {
    if (items.length === 0 && hasMeasured) setHasMeasured(false);
  }, [items.length, hasMeasured]);

  const canAdvance = (() => {
    if (running || exporting) return false;
    if (step === 'setup') {
      return counts.pending > 0 && counts.flagged === 0;
    }
    if (step === 'quantify') {
      return counts.complete > 0 && counts.pending === 0 && counts.flagged === 0 && counts.processing === 0;
    }
    return counts.complete > 0;
  })();

  async function handleAdvance() {
    if (step === 'setup') {
      setHasMeasured(true);
      measure();
      return;
    }
    if (step === 'quantify') {
      // Items are already complete — derive step transitions through useMemo.
      // The CTA is only enabled when everything is ready, so nothing to do here.
      return;
    }
    if (step === 'estimate') {
      const payload: EstimateExport = {
        projectName,
        items,
        totalCost: counts.total,
        exportDate: new Date().toISOString(),
      };
      const res = await exportEstimate(payload);
      if (res.success) {
        console.info('Saved to', res.filePath);
      } else {
        alert(`Export failed: ${res.error}`);
      }
    }
  }

  function handleGoBack(target: WorkflowStep) {
    if (target === 'setup') {
      setHasMeasured(false);
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
                ready: counts.ready,
                estimate: counts.total,
              }}
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

      <StepperFooter
        step={step}
        pendingCount={counts.pending}
        itemCount={items.length}
        flaggedCount={counts.flagged}
        readyCount={counts.ready}
        running={running}
        exporting={exporting}
        canAdvance={canAdvance}
        onAdvance={handleAdvance}
        onGoBack={handleGoBack}
      />
    </div>
  );
}
