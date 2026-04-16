import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { EstimateExport, PayItem } from '@shared/types';
import { MEASUREMENT_UNITS } from '@shared/constants';

import { ProjectHeader } from './components/ProjectHeader';
import { PresetPicker } from './components/PresetPicker';
import { PayItemList } from './components/PayItemList';
import { ActionBar } from './components/ActionBar';
import { EmptyState } from './components/EmptyState';
import { useAutocadStatus } from './hooks/useAutocadStatus';
import { usePayItems } from './hooks/usePayItems';
import { useEstimate } from './hooks/useEstimate';

export function App() {
  const [projectName, setProjectName] = useState('');
  const [pickerOpen, setPickerOpen] = useState(true);

  const status = useAutocadStatus();
  const {
    items,
    addItem,
    updateItem,
    removeItem,
    clearAll,
    applyUpdate,
    resolveFlag,
    setManualQuantity,
  } = usePayItems();
  const { running, exporting, measure, exportEstimate } = useEstimate(items, applyUpdate);

  // Collapse picker when user adds their first item. Only auto-close once
  // — after that, the user controls it via the collapse/expand button.
  const hasAutoCollapsed = useRef(false);
  useEffect(() => {
    if (items.length === 1 && pickerOpen && !hasAutoCollapsed.current) {
      hasAutoCollapsed.current = true;
      setPickerOpen(false);
    }
  }, [items.length, pickerOpen]);

  const stats = useMemo(() => {
    const complete = items.filter((i) => i.status === 'complete').length;
    const flagged = items.filter((i) => i.status === 'flagged').length;
    const pending = items.filter((i) => i.status === 'pending').length;
    const total = items.reduce(
      (sum, i) =>
        sum + (i.quantity ?? 0) * (i.unitPrice ?? 0),
      0,
    );
    return { complete, flagged, pending, total };
  }, [items]);

  const allPriced = items.length > 0 && items.every(
    (i) => i.status === 'complete' || i.status === 'error',
  );

  function handleStartOver() {
    clearAll();
    setProjectName('');
    setPickerOpen(true);
    hasAutoCollapsed.current = false;
  }

  async function handleExport() {
    const payload: EstimateExport = {
      projectName,
      items,
      totalCost: stats.total,
      exportDate: new Date().toISOString(),
    };
    const res = await exportEstimate(payload);
    if (res.success) {
      console.info('Saved to', res.filePath);
    } else {
      alert(`Export failed: ${res.error}`);
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ProjectHeader
        status={status}
        stats={stats}
        unitLabels={MEASUREMENT_UNITS}
      />

      <main
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px 20px 96px',
        }}
      >
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Project Name — e.g. Demorrow Road Reconstruction"
            style={{
              width: '100%',
              padding: '11px 14px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              borderRadius: 8,
              color: 'var(--text-primary)',
              fontSize: 15,
              fontWeight: 500,
              outline: 'none',
              marginBottom: 16,
            }}
          />

          {pickerOpen ? (
            <PresetPicker onAdd={addItem} onCollapse={items.length > 0 ? () => setPickerOpen(false) : undefined} />
          ) : (
            <button
              onClick={() => setPickerOpen(true)}
              style={{
                width: '100%',
                padding: 12,
                background: 'var(--bg-card)',
                border: '1px dashed var(--border-card)',
                borderRadius: 8,
                color: 'var(--accent-blue)',
                fontSize: 13,
                cursor: 'pointer',
                marginBottom: 16,
                transition: 'all 0.12s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent-blue)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-card)';
              }}
            >
              + Add more pay items
            </button>
          )}

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

      {items.length > 0 && (
        <ActionBar
          pendingCount={stats.pending}
          hasComplete={stats.complete > 0}
          running={running}
          exporting={exporting}
          disabledMeasure={stats.pending === 0 || running}
          disabledExport={!allPriced || exporting}
          onMeasure={measure}
          onExport={handleExport}
          onStartOver={handleStartOver}
        />
      )}
    </div>
  );
}
