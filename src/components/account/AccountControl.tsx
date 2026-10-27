import { useState, useMemo } from 'react';
import { useAccountSession, type AccountStatus, type AccountUser } from '@/features/account/use-account-session';
import { t } from '@/lib/i18n';
import { LogIn, LogOut, User, AlertCircle, Loader2, RotateCw } from 'lucide-react';

export interface AccountControlViewProps {
  status: AccountStatus;
  user: AccountUser | null;
  error: string | null;
  onSignIn: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  busy?: boolean;
}

export function createGuardedAction(
  fn?: () => void | Promise<void>,
  onBusyChange?: (busy: boolean) => void
): () => Promise<void> {
  let inFlight = false;
  return async () => {
    if (inFlight || !fn) return;
    inFlight = true;
    onBusyChange?.(true);
    try {
      await fn();
    } finally {
      inFlight = false;
      onBusyChange?.(false);
    }
  };
}

export function AccountControlView({
  status,
  user,
  error: _error,
  onSignIn,
  onSignOut,
  onRetry,
  busy: controlledBusy,
}: AccountControlViewProps) {
  const [internalBusy, setInternalBusy] = useState(false);
  const busy = controlledBusy ?? internalBusy;

  const handleSignIn = useMemo(
    () => createGuardedAction(onSignIn, setInternalBusy),
    [onSignIn]
  );
  const handleSignOut = useMemo(
    () => createGuardedAction(onSignOut, setInternalBusy),
    [onSignOut]
  );
  const handleRetry = useMemo(
    () => createGuardedAction(onRetry, setInternalBusy),
    [onRetry]
  );

  if (status === 'loading') {
    return (
      <div className="account-control account-loading" aria-busy="true" aria-label={t('Memuat akun...')}>
        <button className="account-btn account-btn-loading" disabled type="button">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          <span className="account-btn-text">{t('Memuat akun...')}</span>
        </button>
      </div>
    );
  }

  if (status === 'unavailable') {
    return (
      <div className="account-control account-unavailable" role="status">
        <span className="account-unavailable-badge" title={t('Layanan akun offline (Studio lokal tetap aktif)')}>
          <AlertCircle className="size-3.5" aria-hidden="true" />
          <span className="account-unavailable-text">{t('Layanan akun offline (Studio lokal tetap aktif)')}</span>
        </span>
        {onRetry && (
          <button
            type="button"
            className="account-btn account-btn-retry"
            onClick={handleRetry}
            disabled={busy}
            aria-label={t('Coba lagi menghubungkan akun')}
          >
            <RotateCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span className="account-btn-text">{t('Coba lagi')}</span>
          </button>
        )}
      </div>
    );
  }

  if (status === 'authenticated' && user) {
    const displayName = user.name || user.email.split('@')[0];
    return (
      <div className="account-control account-authenticated">
        <div className="account-user-badge" title={user.email}>
          {user.image ? (
            <img src={user.image} alt="" className="account-avatar" aria-hidden="true" />
          ) : (
            <span className="account-avatar-placeholder" aria-hidden="true">
              <User className="size-3.5" />
            </span>
          )}
          <span className="account-user-name">{displayName}</span>
        </div>
        <button
          type="button"
          className="account-btn account-btn-signout"
          onClick={handleSignOut}
          disabled={busy}
          aria-label={t('Keluar')}
        >
          <LogOut className="size-4" aria-hidden="true" />
          <span className="account-btn-text">{t('Keluar')}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="account-control account-guest">
      <button
        type="button"
        className="account-btn account-btn-signin"
        onClick={handleSignIn}
        disabled={busy}
        aria-label={t('Masuk dengan Google')}
      >
        <LogIn className="size-4" aria-hidden="true" />
        <span className="account-btn-text">{t('Masuk')}</span>
      </button>
    </div>
  );
}

export function AccountControl() {
  const session = useAccountSession();

  return (
    <AccountControlView
      status={session.status}
      user={session.user}
      error={session.error}
      onSignIn={session.signInWithGoogle}
      onSignOut={session.signOut}
      onRetry={session.refresh}
    />
  );
}
