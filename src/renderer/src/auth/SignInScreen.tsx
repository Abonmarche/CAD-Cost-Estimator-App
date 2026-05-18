import { useState } from 'react';
import { LogIn, Loader2, AlertCircle } from 'lucide-react';

import { useAuth } from './AuthContext';

export function SignInScreen() {
  const { state, signIn } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await signIn();
      if (!result.success) {
        setError(result.error ?? 'Sign-in failed.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const isLoading = state.status === 'loading';

  return (
    <div className="flex h-full flex-col bg-page-hero">
      <div className="h-12 bg-navy" />
      <div className="h-1 w-full bg-brand" aria-hidden />
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-cloud bg-white p-8 text-center shadow-elevated">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-navy text-base font-bold text-white">
            CE
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy">
            Cost Estimator
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate">
            Sign in with your Abonmarche Microsoft account to continue.
          </p>

          <div className="mt-6">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 rounded-lg bg-cloud px-4 py-3 text-sm text-slate">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking saved sign-in…
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSignIn}
                disabled={submitting}
                className="btn-primary w-full"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Waiting for browser…
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4" />
                    Sign in with Microsoft
                  </>
                )}
              </button>
            )}
          </div>

          {submitting && !isLoading && (
            <p className="mt-4 text-xs leading-relaxed text-slate">
              A browser window opened for sign-in. After signing in, this app
              will continue automatically.
            </p>
          )}

          {(error ?? state.lastError) && !submitting && (
            <div className="mt-5 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-left">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
              <div className="text-xs text-danger">
                {error ?? state.lastError}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
