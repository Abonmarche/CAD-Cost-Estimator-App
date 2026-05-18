/**
 * In-app "Report a bug" / "Request enhancement" modal.
 *
 * Adapted from Abonmarche/ACI-CRM's component, restyled to the Cost
 * Estimator's dark inline-style idiom (no Tailwind, CSS variables for
 * theming). Submission goes via IPC to the main process, which holds the
 * MSAL token and POSTs to the feedback Function App.
 */

import { useEffect, useRef, useState } from 'react';
import { Bug, Lightbulb, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

import type { FeedbackResult, FeedbackType } from '@shared/types';

import { useAuth } from '../auth/AuthContext';

interface Props {
  type: FeedbackType;
  onClose: () => void;
}

const TITLE: Record<FeedbackType, string> = {
  bug: 'Report a bug',
  enhancement: 'Request an enhancement',
};

const DESCRIPTION_PLACEHOLDER: Record<FeedbackType, string> = {
  bug: 'What were you doing when it broke? What did you expect to see? What actually happened?',
  enhancement: 'What would you like the app to do? Who benefits, and how often would you use it?',
};

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 10_000;

type Stage =
  | { kind: 'editing' }
  | { kind: 'submitting' }
  | { kind: 'success'; issueNumber: number; url: string }
  | { kind: 'error'; message: string };

export function FeedbackModal({ type, onClose }: Props) {
  const { state } = useAuth();
  const account = state.account;

  const [name, setName] = useState(account?.name ?? '');
  const [email, setEmail] = useState(account?.username ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stage, setStage] = useState<Stage>({ kind: 'editing' });

  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stage.kind !== 'submitting') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, stage.kind]);

  useEffect(() => {
    if (stage.kind !== 'success') return;
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [stage, onClose]);

  const Icon = type === 'bug' ? Bug : Lightbulb;
  const isSubmitting = stage.kind === 'submitting';
  const canSubmit =
    name.trim() && email.trim() && title.trim() && description.trim() && !isSubmitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!account) {
      setStage({ kind: 'error', message: 'You are not signed in.' });
      return;
    }
    setStage({ kind: 'submitting' });
    try {
      const result: FeedbackResult = await window.costEstimator.feedback.submit({
        type,
        title: title.trim(),
        description: description.trim(),
        submitterName: name.trim(),
        submitterEmail: email.trim(),
      });
      if (result.ok) {
        setStage({
          kind: 'success',
          issueNumber: result.issue.number,
          url: result.issue.url,
        });
      } else {
        setStage({
          kind: 'error',
          message: errorMessage(result.error.code, result.error.message),
        });
      }
    } catch (err) {
      setStage({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Submission failed — please try again.',
      });
    }
  }

  const accent = type === 'bug' ? 'var(--accent-red)' : 'var(--accent-blue)';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(15, 17, 23, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-card)',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: `${accent}18`,
              color: accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon size={18} />
          </div>
          <h2
            id="feedback-modal-title"
            style={{
              flex: 1,
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            {TITLE[type]}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 6,
              borderRadius: 6,
              color: 'var(--text-muted)',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.5 : 1,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {stage.kind === 'success' ? (
          <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <CheckCircle2 size={20} style={{ color: 'var(--accent-green)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                  Thanks — your report has been submitted.
                </div>
                <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-muted)' }}>
                  Filed as{' '}
                  <a
                    href={stage.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}
                  >
                    issue #{stage.issueNumber}
                  </a>
                  .
                </div>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ padding: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <Field label="Your name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isSubmitting}
                  required
                  style={inputStyle()}
                />
              </Field>
              <Field label="Your email">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isSubmitting}
                  required
                  style={inputStyle()}
                />
              </Field>
            </div>

            <div style={{ marginBottom: 12 }}>
              <Field label="Title">
                <input
                  ref={titleRef}
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
                  placeholder={type === 'bug' ? 'Short summary of what broke' : 'Short summary of your idea'}
                  disabled={isSubmitting}
                  required
                  maxLength={MAX_TITLE}
                  style={inputStyle()}
                />
              </Field>
            </div>

            <div style={{ marginBottom: 12 }}>
              <Field label="Description">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION))}
                  placeholder={DESCRIPTION_PLACEHOLDER[type]}
                  disabled={isSubmitting}
                  required
                  maxLength={MAX_DESCRIPTION}
                  style={{ ...inputStyle(), minHeight: 140, resize: 'vertical', fontFamily: 'inherit' }}
                />
              </Field>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 11,
                  color: 'var(--text-dim)',
                  textAlign: 'right',
                }}
              >
                {description.length}/{MAX_DESCRIPTION}
              </div>
            </div>

            {stage.kind === 'error' && (
              <div
                style={{
                  padding: 12,
                  marginBottom: 12,
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                }}
              >
                <AlertCircle size={16} style={{ color: 'var(--accent-red)', flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 13, color: 'var(--accent-red)' }}>
                  <div>{stage.message}</div>
                  <div style={{ marginTop: 4, fontSize: 11, opacity: 0.85 }}>
                    If this keeps happening, email{' '}
                    <a
                      href="mailto:ggarcia@abonmarche.com"
                      style={{ color: 'var(--accent-red)', textDecoration: 'underline' }}
                    >
                      ggarcia@abonmarche.com
                    </a>
                    .
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                style={{
                  padding: '8px 14px',
                  background: 'transparent',
                  border: '1px solid var(--border-card)',
                  borderRadius: 6,
                  color: 'var(--text-secondary)',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                style={{
                  padding: '8px 14px',
                  background: canSubmit ? 'var(--accent-blue)' : 'var(--bg-card)',
                  border: 'none',
                  borderRadius: 6,
                  color: canSubmit ? 'white' : 'var(--text-dim)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    Submitting…
                  </>
                ) : (
                  'Submit'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-muted)',
          marginBottom: 6,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </div>
      {children}
    </label>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    width: '100%',
    padding: '8px 12px',
    background: 'var(--bg-input)',
    border: '1px solid var(--border-card)',
    borderRadius: 6,
    color: 'var(--text-primary)',
    fontSize: 13,
    outline: 'none',
  };
}

function errorMessage(code: string, message?: string): string {
  switch (code) {
    case 'rate_limited':
      return 'You have submitted a lot of feedback recently. Please wait a few minutes and try again.';
    case 'unauthorized':
      return 'Your session expired. Please sign out and sign back in, then retry.';
    case 'validation_error':
      return message ?? 'One of the fields did not pass validation.';
    case 'upstream_error':
      return "We couldn't reach GitHub right now. Please try again in a minute.";
    case 'server_misconfigured':
      return 'The feedback service is misconfigured. Please email support.';
    default:
      return message ?? 'Submission failed. Please try again.';
  }
}
