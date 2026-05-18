/**
 * Renderer-side auth state. Mirrors the main process's state machine and
 * exposes signIn / signOut actions. The main process is the source of
 * truth — this context just receives broadcasts.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

import type { AuthState } from '@shared/types';

interface AuthContextValue {
  state: AuthState;
  signIn(): Promise<{ success: boolean; error?: string }>;
  signOut(): Promise<void>;
}

const Ctx = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', account: null });

  useEffect(() => {
    let cancelled = false;
    // Subscribe to broadcasts before fetching, so we don't miss an
    // early-boot setSignedIn that fires between mount and getState.
    const unsub = window.costEstimator.auth.onStateChange((s) => {
      if (!cancelled) setState(s);
    });
    window.costEstimator.auth.getState().then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const signIn = useCallback(async () => {
    return await window.costEstimator.auth.signIn();
  }, []);

  const signOut = useCallback(async () => {
    await window.costEstimator.auth.signOut();
  }, []);

  return <Ctx.Provider value={{ state, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useAuth must be used inside an <AuthProvider>');
  return value;
}
