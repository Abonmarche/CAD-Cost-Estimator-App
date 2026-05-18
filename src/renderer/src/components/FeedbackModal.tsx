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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-navy/40 p-6"
    >
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-cloud bg-white shadow-elevated">
        <div className="flex items-center gap-3 border-b border-cloud px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cloud text-sapphire">
            <Icon className="h-4 w-4" />
          </div>
          <h2
            id="feedback-modal-title"
            className="flex-1 text-sm font-semibold text-charcoal"
          >
            {TITLE[type]}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate transition-colors hover:bg-cloud hover:text-charcoal disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {stage.kind === 'success' ? (
          <div className="p-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-success" />
              <div>
                <div className="text-sm font-semibold text-charcoal">
                  Thanks — your report has been submitted.
                </div>
                <div className="mt-1 text-sm text-slate">
                  Filed as{' '}
                  <a
                    href={stage.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sapphire underline"
                  >
                    issue #{stage.issueNumber}
                  </a>
                  .
                </div>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Your name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isSubmitting}
                  required
                  className="field-input"
                />
              </Field>
              <Field label="Your email">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isSubmitting}
                  required
                  className="field-input"
                />
              </Field>
            </div>

            <div className="mt-3">
              <Field label="Title">
                <input
                  ref={titleRef}
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
                  placeholder={
                    type === 'bug'
                      ? 'Short summary of what broke'
                      : 'Short summary of your idea'
                  }
                  disabled={isSubmitting}
                  required
                  maxLength={MAX_TITLE}
                  className="field-input"
                />
              </Field>
            </div>

            <div className="mt-3">
              <Field label="Description">
                <textarea
                  value={description}
                  onChange={(e) =>
                    setDescription(e.target.value.slice(0, MAX_DESCRIPTION))
                  }
                  placeholder={DESCRIPTION_PLACEHOLDER[type]}
                  disabled={isSubmitting}
                  required
                  maxLength={MAX_DESCRIPTION}
                  className="field-input h-36 resize-y py-2 align-top leading-relaxed"
                />
              </Field>
              <div className="mt-1 text-right text-[11px] text-slate">
                {description.length}/{MAX_DESCRIPTION}
              </div>
            </div>

            {stage.kind === 'error' && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
                <div className="text-sm text-danger">
                  <div>{stage.message}</div>
                  <div className="mt-1 text-xs opacity-80">
                    If this keeps happening, email{' '}
                    <a
                      href="mailto:ggarcia@abonmarche.com"
                      className="underline"
                    >
                      ggarcia@abonmarche.com
                    </a>
                    .
                  </div>
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="btn-primary"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
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
    <label className="block">
      <div className="field-label">{label}</div>
      {children}
    </label>
  );
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
