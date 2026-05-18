/**
 * Blocking sign-in screen. Shown whenever auth state is 'signedOut' or
 * 'loading' (loading shows a spinner instead of the button to avoid a
 * flash when the cache has a valid account).
 */

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
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-deep)',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 420,
          width: '100%',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          padding: 32,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 12,
            background:
              'linear-gradient(135deg, var(--abonmarche-navy), #1e3a5f)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            fontSize: 24,
            fontWeight: 700,
            color: 'var(--abonmarche-red)',
          }}
        >
          A
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: 'var(--text-primary)',
          }}
        >
          Cost Estimator
        </h1>
        <p
          style={{
            marginTop: 8,
            marginBottom: 28,
            fontSize: 13,
            color: 'var(--text-muted)',
            lineHeight: 1.5,
          }}
        >
          Sign in with your Abonmarche Microsoft account to continue.
        </p>

        {isLoading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: 14,
              color: 'var(--text-muted)',
              fontSize: 13,
            }}
          >
            <Loader2 size={16} className="row-enter" style={{ animation: 'spin 1s linear infinite' }} />
            Checking saved sign-in…
          </div>
        ) : (
          <button
            type="button"
            onClick={handleSignIn}
            disabled={submitting}
            style={{
              width: '100%',
              padding: '12px 16px',
              background: 'var(--accent-blue)',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: submitting ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              transition: 'background 0.12s ease',
            }}
            onMouseEnter={(e) => {
              if (!submitting) e.currentTarget.style.background = 'var(--accent-blue-strong)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--accent-blue)';
            }}
          >
            {submitting ? (
              <>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                Waiting for browser…
              </>
            ) : (
              <>
                <LogIn size={16} />
                Sign in with Microsoft
              </>
            )}
          </button>
        )}

        {submitting && !isLoading && (
          <p
            style={{
              marginTop: 14,
              marginBottom: 0,
              fontSize: 12,
              color: 'var(--text-dim)',
              lineHeight: 1.5,
            }}
          >
            A browser window opened for sign-in. After signing in, this app
            will continue automatically.
          </p>
        )}

        {(error ?? state.lastError) && !submitting && (
          <div
            style={{
              marginTop: 18,
              padding: 12,
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              textAlign: 'left',
            }}
          >
            <AlertCircle size={16} style={{ color: 'var(--accent-red)', flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12, color: 'var(--accent-red)' }}>
              {error ?? state.lastError}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
