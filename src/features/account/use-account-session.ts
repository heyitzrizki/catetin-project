import { useState, useEffect, useCallback } from 'react';
import { authClient } from './auth-client.ts';

export interface AccountUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export type AccountStatus = 'loading' | 'guest' | 'authenticated' | 'unavailable';

export interface AccountSessionState {
  status: AccountStatus;
  user: AccountUser | null;
  sessionId?: string | null;
  error: string | null;
}

export interface UseAccountSessionResult extends AccountSessionState {
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function resolveSessionState(
  payload: { data?: { user?: any; session?: any } | null; error?: { status?: number; message?: string } | null } | null,
  thrownError: unknown
): AccountSessionState {
  if (thrownError) {
    return {
      status: 'unavailable',
      user: null,
      sessionId: null,
      error: thrownError instanceof Error ? thrownError.message : 'auth_unavailable',
    };
  }

  if (payload?.error) {
    if (payload.error.status === 401 || payload.error.status === 403) {
      return { status: 'guest', user: null, sessionId: null, error: null };
    }
    return {
      status: 'unavailable',
      user: null,
      sessionId: null,
      error: payload.error.message || 'auth_unavailable',
    };
  }

  const user = payload?.data?.user;
  const session = payload?.data?.session;
  if (user && typeof user.id === 'string' && typeof user.email === 'string') {
    return {
      status: 'authenticated',
      user: {
        id: user.id,
        name: user.name || user.email.split('@')[0],
        email: user.email,
        image: user.image ?? null,
      },
      sessionId: session?.id ?? null,
      error: null,
    };
  }

  return { status: 'guest', user: null, sessionId: null, error: null };
}

export async function executeSignOut(
  client: { signOut: () => Promise<{ error?: { message?: string } | null } | void> },
  fetchSession: () => Promise<AccountSessionState>,
  setCurrentState: (state: AccountSessionState) => void
): Promise<AccountSessionState> {
  try {
    const res = await client.signOut();
    if (res && typeof res === 'object' && 'error' in res && res.error) {
      const serverState = await fetchSession();
      const nextState: AccountSessionState = {
        ...serverState,
        error: res.error.message || 'sign_out_failed',
      };
      setCurrentState(nextState);
      return nextState;
    }
    const guestState: AccountSessionState = { status: 'guest', user: null, error: null };
    setCurrentState(guestState);
    return guestState;
  } catch (err) {
    const serverState = await fetchSession();
    const nextState: AccountSessionState = {
      ...serverState,
      error: err instanceof Error ? err.message : 'sign_out_failed',
    };
    setCurrentState(nextState);
    return nextState;
  }
}

export function useAccountSession(): UseAccountSessionResult {
  const [state, setState] = useState<AccountSessionState>({
    status: 'loading',
    user: null,
    error: null,
  });

  const fetchSession = useCallback(async (): Promise<AccountSessionState> => {
    try {
      const res = await authClient.getSession();
      const next = resolveSessionState(res, null);
      setState(next);
      return next;
    } catch (err) {
      const next = resolveSessionState(null, err);
      setState(next);
      return next;
    }
  }, []);

  useEffect(() => {
    void fetchSession();
  }, [fetchSession]);

  const signInWithGoogle = useCallback(async () => {
    try {
      const callbackURL = typeof window !== 'undefined' ? window.location.href : '/';
      await authClient.signIn.social({
        provider: 'google',
        callbackURL,
      });
    } catch (err) {
      setState(resolveSessionState(null, err));
    }
  }, []);

  const signOut = useCallback(async () => {
    await executeSignOut(authClient, fetchSession, setState);
  }, [fetchSession]);

  return {
    ...state,
    signInWithGoogle,
    signOut,
    refresh: async () => {
      await fetchSession();
    },
  };
}
