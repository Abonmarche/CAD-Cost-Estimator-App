import { useEffect, useRef, useState } from 'react';
import { Bug, Database, Lightbulb, LogOut, PlugZap, Loader2 } from 'lucide-react';

import type {
  CostEstDbStatus,
  FeedbackType,
  ServerStatus,
  UpdateCheckResult,
} from '@shared/types';

import { useAppVersion } from '../hooks/useAppVersion';
import { useAuth } from '../auth/AuthContext';

interface Props {
  status: ServerStatus;
  mcpStatus: CostEstDbStatus;
  onOpenFeedback: (type: FeedbackType) => void;
}

export function AppHeader({ status, mcpStatus, onOpenFeedback }: Props) {
  return (
    <header className="flex flex-shrink-0 flex-col">
      <div className="flex items-center justify-between gap-4 bg-navy px-6 py-3 text-white">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white text-sm font-bold text-navy">
            CE
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold tracking-tight">Cost Estimator</h1>
              <VersionPill />
            </div>
            <p className="truncate text-xs text-white/60">
              AutoCAD quantity takeoff · MCP cost estimating workflow
            </p>
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2 text-sm">
          <DrawingChip status={status} />
          <CostEstDbChip status={mcpStatus} />
          <span className="mx-1 h-6 w-px bg-white/15" aria-hidden />
          <IconButton title="Report a bug" onClick={() => onOpenFeedback('bug')}>
            <Bug className="h-4 w-4" />
          </IconButton>
          <IconButton title="Request an enhancement" onClick={() => onOpenFeedback('enhancement')}>
            <Lightbulb className="h-4 w-4" />
          </IconButton>
          <UserBadge />
        </div>
      </div>
      {/* Abonmarche brand stripe — the only place red appears in-app. */}
      <div className="h-1 w-full bg-brand" aria-hidden />
    </header>
  );
}

function IconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40"
    >
      {children}
    </button>
  );
}

function VersionPill() {
  const version = useAppVersion();
  const [check, setCheck] = useState<{
    state: 'idle' | 'checking' | 'done';
    result?: UpdateCheckResult;
  }>({ state: 'idle' });
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, []);

  async function runCheck() {
    if (check.state === 'checking') return;
    if (clearTimer.current) {
      clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
    setCheck({ state: 'checking' });
    try {
      const result = await window.costEstimator.checkForUpdates();
      setCheck({ state: 'done', result });
      if (result.status === 'up-to-date' || result.status === 'downloading') {
        clearTimer.current = setTimeout(() => setCheck({ state: 'idle' }), 6000);
      }
    } catch (e) {
      setCheck({
        state: 'done',
        result: {
          status: 'error',
          currentVersion: version ?? '?',
          message: (e as Error).message ?? 'Check failed.',
        },
      });
    }
  }

  if (!version) return null;

  const tooltip = renderCheckTooltip(check);

  return (
    <button
      type="button"
      onClick={runCheck}
      disabled={check.state === 'checking'}
      title={tooltip ?? 'Click to check for updates'}
      className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-0.5 font-mono text-[11px] font-medium text-white/80 transition-colors hover:bg-white/15 disabled:cursor-wait"
    >
      v{version}
      {check.state === 'checking' && <Loader2 className="h-3 w-3 animate-spin" />}
      {check.state === 'done' && check.result?.status === 'update-available' && (
        <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden />
      )}
    </button>
  );
}

function renderCheckTooltip(check: {
  state: 'idle' | 'checking' | 'done';
  result?: UpdateCheckResult;
}): string | null {
  if (check.state !== 'done' || !check.result) return null;
  const r = check.result;
  switch (r.status) {
    case 'up-to-date':
      return "You're on the latest version";
    case 'update-available':
      return `Update v${r.latestVersion} available`;
    case 'downloading':
      return `v${r.latestVersion} downloading — restart prompt will appear`;
    case 'check-running':
    case 'disabled':
    case 'error':
      return r.message;
    default:
      return null;
  }
}

function DrawingChip({ status }: { status: ServerStatus }) {
  const ready = status.connected;
  const label = ready
    ? status.document || 'Drawing connected'
    : status.error
      ? 'AutoCAD disconnected'
      : 'AutoCAD connecting…';
  return (
    <div
      title={status.error ?? status.document ?? ''}
      className="inline-flex max-w-[220px] items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/85"
    >
      <PlugZap className={`h-3.5 w-3.5 ${ready ? 'text-success' : 'text-white/50'}`} />
      <span className="truncate">{label}</span>
    </div>
  );
}

function CostEstDbChip({ status }: { status: CostEstDbStatus }) {
  const ready = status.connected;
  const label = ready
    ? `CostEstDB connected${status.toolCount ? ` · ${status.toolCount} tools` : ''}`
    : status.error
      ? 'CostEstDB offline'
      : 'CostEstDB connecting…';
  const tooltip = ready
    ? `Pricing MCP connected${status.url ? ` (${status.url})` : ''}`
    : (status.error ?? 'Connecting to CostEstDB MCP…');
  return (
    <div
      title={tooltip}
      className="inline-flex max-w-[260px] items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/85"
    >
      <Database className={`h-3.5 w-3.5 ${ready ? 'text-success' : 'text-white/50'}`} />
      <span className="truncate">{label}</span>
    </div>
  );
}

function UserBadge() {
  const { state, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  if (state.status !== 'signedIn' || !state.account) return null;
  const acc = state.account;
  const initials = (acc.name || acc.username)
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${acc.name || acc.username} (${acc.username})`}
        aria-label="Account menu"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-sapphire text-xs font-bold text-white transition-colors hover:bg-sapphire/80 focus:outline-none focus:ring-2 focus:ring-white/40"
      >
        {initials || '?'}
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 min-w-[240px] rounded-xl border border-cloud bg-white p-2 text-charcoal shadow-elevated">
          <div className="border-b border-cloud px-3 py-2">
            <div className="text-xs font-semibold text-charcoal">
              {acc.name || acc.username}
            </div>
            <div className="mt-0.5 text-[11px] text-slate">{acc.username}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-charcoal transition-colors hover:bg-cloud"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
