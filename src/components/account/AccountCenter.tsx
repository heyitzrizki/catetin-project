import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAccountSession, type AccountStatus, type AccountUser, type UseAccountSessionResult } from '@/features/account/use-account-session';
import {
  fetchAccountSummary,
  fetchAccountEntitlement,
  listUserSessions,
  revokeOtherUserSessions,
  revokeSingleSession,
  deleteCloudAccount,
  humanizeUserAgent,
  type AccountSummary,
  type AccountSessionItem,
  type AccountEntitlement,
} from '@/features/account/account-api';
import { t } from '@/lib/i18n';
import {
  ArrowLeft,
  User,
  ShieldCheck,
  Laptop,
  Smartphone,
  LogOut,
  Trash2,
  Loader2,
  AlertCircle,
  FileText,
  FileAudio,
  Archive,
  RotateCw,
  HardDrive,
  Info,
  Sparkles,
} from 'lucide-react';
import { createGuardedAction } from './AccountControl';
import { SignOutConfirmDialog } from './SignOutConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface AccountCenterViewProps {
  status: AccountStatus;
  user: AccountUser | null;
  currentSessionId?: string | null;
  summaryStatus?: 'loading' | 'success' | 'error';
  summary: AccountSummary | null;
  summaryError?: string | null;
  entitlementStatus?: 'loading' | 'success' | 'error';
  entitlement?: AccountEntitlement | null;
  entitlementError?: string | null;
  sessionsStatus?: 'loading' | 'success' | 'error';
  sessions: AccountSessionItem[];
  sessionsError?: string | null;
  localStats?: {
    projectCount: number;
    recordingCount: number;
    totalDurationSec: number;
  };
  actionBusy?: boolean;
  onBack: () => void;
  onSignOut: () => Promise<{ success: true } | void> | { success: true } | void;
  onRevokeOtherSessions: () => Promise<void>;
  onRevokeSession: (token: string) => Promise<void>;
  onDeleteAccount: () => Promise<void>;
  onRetry: () => void;
  onRetrySummary?: () => void;
  onRetrySessions?: () => void;
  onRetryEntitlement?: () => void;
  onOpenPricing?: () => void;
  onSignIn: () => void | Promise<void>;
}

export function AccountCenterView({
  status,
  user,
  currentSessionId,
  summaryStatus = 'success',
  summary,
  summaryError,
  entitlementStatus = 'success',
  entitlement,
  entitlementError,
  sessionsStatus = 'success',
  sessions,
  sessionsError,
  localStats,
  actionBusy = false,
  onBack,
  onSignOut,
  onRevokeOtherSessions,
  onRevokeSession,
  onDeleteAccount,
  onRetry,
  onRetrySummary,
  onRetrySessions,
  onRetryEntitlement,
  onOpenPricing,
  onSignIn,
}: AccountCenterViewProps) {
  const [internalBusy, setInternalBusy] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const signOutTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Requirement 7: Concurrency guard for revoking session tokens
  const inFlightTokensRef = useRef<Set<string>>(new Set());
  const [inFlightTokens, setInFlightTokens] = useState<Set<string>>(new Set());

  // Requirement 6: Ref for initial focus on cancel button inside Radix dialog
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);

  const busy = actionBusy || internalBusy;

  const handleGuardedSignOut = useMemo(
    () => createGuardedAction(onSignOut, setInternalBusy),
    [onSignOut]
  );

  const handleRevokeOthers = useMemo(
    () =>
      createGuardedAction(async () => {
        setActionMessage(null);
        try {
          await onRevokeOtherSessions();
          setActionMessage({ text: t('Berhasil keluar dari seluruh perangkat lain.'), type: 'success' });
        } catch {
          setActionMessage({ text: t('Gagal mengeluarkan sesi lain.'), type: 'error' });
        }
      }, setInternalBusy),
    [onRevokeOtherSessions]
  );

  // Requirement 7: Guarded revoke per session token prevents rapid double click
  const handleRevokeSingle = useCallback(
    async (token: string) => {
      if (!token || inFlightTokensRef.current.has(token)) return;

      inFlightTokensRef.current.add(token);
      setInFlightTokens(new Set(inFlightTokensRef.current));
      setActionMessage(null);

      try {
        await onRevokeSession(token);
        setActionMessage({ text: t('Sesi berhasil dikeluarkan.'), type: 'success' });
      } catch {
        setActionMessage({ text: t('Gagal mengeluarkan sesi.'), type: 'error' });
      } finally {
        inFlightTokensRef.current.delete(token);
        setInFlightTokens(new Set(inFlightTokensRef.current));
      }
    },
    [onRevokeSession]
  );

  const handleConfirmDelete = useMemo(
    () =>
      createGuardedAction(async () => {
        setActionMessage(null);
        try {
          await onDeleteAccount();
          setDeleteConfirmOpen(false);
        } catch {
          setActionMessage({ text: t('Gagal menghapus akun cloud.'), type: 'error' });
        }
      }, setInternalBusy),
    [onDeleteAccount]
  );

  // Loading State (Requirement 8: id="main-content" tabIndex={-1})
  if (status === 'loading') {
    return (
      <main id="main-content" tabIndex={-1} className="account-center-container" aria-busy="true">
        <div className="account-center-card text-center py-16">
          <Loader2 className="size-8 animate-spin mx-auto text-stone-500 mb-4" aria-hidden="true" />
          <h2 className="text-lg font-medium text-stone-800">{t('Memuat akun...')}</h2>
          <p className="text-sm text-stone-500 mt-1">{t('Menghubungkan ke layanan identitas')}</p>
        </div>
      </main>
    );
  }

  // Unavailable State (Requirement 8: id="main-content" tabIndex={-1})
  if (status === 'unavailable') {
    return (
      <main id="main-content" tabIndex={-1} className="account-center-container">
        <header className="mb-6 flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="account-btn inline-flex items-center gap-2 text-stone-600 hover:text-stone-900"
            aria-label={t('Kembali')}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span>{t('Kembali')}</span>
          </button>
        </header>
        <div className="account-center-card border-amber-200 bg-amber-50/50 p-6 rounded-2xl">
          <div className="flex items-start gap-3">
            <AlertCircle className="size-6 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-stone-900">
                {t('Layanan akun offline (Studio lokal tetap aktif)')}
              </h2>
              <p className="text-sm text-stone-600 mt-1">
                {t('Koneksi ke backend akun cloud sedang tidak tersedia. Rekaman dan Studio lokal Anda di browser ini tetap dapat digunakan dengan aman tanpa gangguan.')}
              </p>
              <button
                type="button"
                onClick={onRetry}
                disabled={busy}
                className="account-btn account-btn-retry mt-4 inline-flex items-center gap-2 bg-stone-900 text-stone-50 px-4 py-2 rounded-lg text-sm font-medium hover:bg-stone-800"
              >
                <RotateCw className={`size-4 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span>{t('Coba lagi')}</span>
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Guest State (Requirement 8: id="main-content" tabIndex={-1})
  if (status === 'guest' || !user) {
    return (
      <main id="main-content" tabIndex={-1} className="account-center-container">
        <header className="mb-6">
          <button
            type="button"
            onClick={onBack}
            className="account-btn inline-flex items-center gap-2 text-stone-600 hover:text-stone-900"
            aria-label={t('Kembali')}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span>{t('Kembali')}</span>
          </button>
        </header>
        <div className="account-center-card p-8 rounded-2xl border border-stone-200 bg-white text-center max-w-lg mx-auto">
          <div className="size-12 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4 text-stone-600">
            <User className="size-6" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-serif text-stone-900 mb-2">{t('Pusat Akun Catetin')}</h2>
          <p className="text-sm text-stone-600 mb-6 leading-relaxed">
            {t('Masuk dengan akun Google untuk melihat riwayat aktivitas dan mengelola sesi perangkat. Audio dan naskah transkripsi Anda akan selalu tersimpan lokal di perangkat ini.')}
          </p>
          <button
            type="button"
            onClick={onSignIn}
            disabled={busy}
            className="account-btn inline-flex items-center justify-center gap-2 w-full bg-stone-900 text-stone-50 px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-stone-800 transition-colors"
            aria-label={t('Masuk dengan Google')}
          >
            <User className="size-4" aria-hidden="true" />
            <span>{t('Masuk dengan Google')}</span>
          </button>
        </div>
      </main>
    );
  }

  // Authenticated State (Requirement 8: id="main-content" tabIndex={-1})
  const createdAtFormatted = summary?.user?.createdAt
    ? new Date(summary.user.createdAt).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '';

  const totals = summary?.usage?.totals ?? {
    local_transcription_completed: 0,
    transcript_export_completed: 0,
    catetin_backup_completed: 0,
  };

  const hasActivity = (summary?.usage?.totalCount ?? 0) > 0;
  const otherSessions = sessions.filter((s) => s.id !== currentSessionId);

  return (
    <main id="main-content" tabIndex={-1} className="account-center-container max-w-4xl mx-auto px-4 py-8">
      {/* Top Navigation */}
      <header className="mb-8 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="account-btn inline-flex items-center gap-2 text-stone-600 hover:text-stone-900 text-sm font-medium transition-colors"
          aria-label={t('Kembali')}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          <span>{t('Kembali')}</span>
        </button>
        <span className="text-xs uppercase tracking-wider font-mono text-stone-400">
          {t('Pusat Akun')}
        </span>
      </header>

      {/* Action Notification Banner */}
      {actionMessage && (
        <div
          role="status"
          className={`mb-6 p-4 rounded-xl text-sm flex items-center gap-2 ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          <Info className="size-4 shrink-0" aria-hidden="true" />
          <span>{actionMessage.text}</span>
        </div>
      )}

      {/* Reassurance Banner */}
      <section className="mb-8 p-4 rounded-xl bg-stone-50 border border-stone-200 flex items-start gap-3">
        <ShieldCheck className="size-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-xs text-stone-600 leading-relaxed">
          {t(
            'Akun dan sesi Anda disimpan di cloud secara aman. Rekaman audio, transkrip, dan proyek Anda tetap berada di perangkat lokal ini dan tidak pernah diunggah.'
          )}
        </p>
      </section>

      <div className="space-y-8">
        {/* Section 1: Profil Akun */}
        <section className="account-section bg-white p-6 rounded-2xl border border-stone-200 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              {user.image ? (
                <img
                  src={user.image}
                  alt=""
                  className="size-16 rounded-full object-cover border border-stone-200"
                  aria-hidden="true"
                />
              ) : (
                <div className="size-16 rounded-full bg-stone-100 flex items-center justify-center text-stone-600 border border-stone-200">
                  <User className="size-8" aria-hidden="true" />
                </div>
              )}
              <div>
                <h1 className="text-lg font-semibold text-stone-900">{user.name}</h1>
                <p className="text-sm font-mono text-stone-500">{user.email}</p>
                {createdAtFormatted && (
                  <p className="text-xs text-stone-400 mt-1">
                    {t('Bergabung sejak')} {createdAtFormatted}
                  </p>
                )}
              </div>
            </div>
            <button
              ref={signOutTriggerRef}
              type="button"
              onClick={() => setSignOutConfirmOpen(true)}
              disabled={busy}
              className="account-btn inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-50 text-sm font-medium transition-colors"
              aria-label={t('Keluar')}
            >
              <LogOut className="size-4" aria-hidden="true" />
              <span>{t('Keluar')}</span>
            </button>
            <SignOutConfirmDialog
              open={signOutConfirmOpen}
              onOpenChange={setSignOutConfirmOpen}
              onConfirm={handleGuardedSignOut}
              triggerRef={signOutTriggerRef}
            />
          </div>
        </section>

        {/* Section: Paket Akun (Stage 4C1 Entitlement) */}
        <section className="account-section bg-white p-6 rounded-2xl border border-stone-200 shadow-xs">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-stone-900">{t('Paket Akun')}</h2>
              <p className="text-xs text-stone-500 mt-0.5">
                {t('Status langganan dan akses fitur akun Anda.')}
              </p>
            </div>
            {onOpenPricing ? (
              <button
                type="button"
                onClick={onOpenPricing}
                className="text-xs font-medium text-stone-600 hover:text-stone-900 transition-colors"
              >
                {t('Detail paket & harga')} &rarr;
              </button>
            ) : (
              <a
                href="#pricing"
                className="text-xs font-medium text-stone-600 hover:text-stone-900 transition-colors"
              >
                {t('Detail paket & harga')} &rarr;
              </a>
            )}
          </div>

          {entitlementStatus === 'loading' ? (
            <div className="py-6 text-center text-stone-400" aria-busy="true">
              <Loader2 className="size-5 animate-spin mx-auto mb-2" aria-hidden="true" />
              <span className="text-xs">{t('Memuat status paket...')}</span>
            </div>
          ) : entitlementStatus === 'error' ? (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
                <span>{entitlementError || t('Gagal memuat status paket akun.')}</span>
              </div>
              {onRetryEntitlement && (
                <button
                  type="button"
                  onClick={onRetryEntitlement}
                  className="account-btn px-2.5 py-1 text-xs font-medium text-amber-900 border border-amber-300 rounded-md hover:bg-amber-100"
                >
                  {t('Coba lagi')}
                </button>
              )}
            </div>
          ) : entitlement?.plan === 'pro' ? (
            <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-[#172f49] text-white">
                    <Sparkles className="size-4 text-amber-400" aria-hidden="true" />
                  </span>
                  <span className="text-sm font-semibold text-stone-900">{t('Catetin Pro')}</span>
                </div>
                <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                  entitlement.status === 'grace'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {entitlement.status === 'grace' ? t('Masa tenggang') : t('Aktif')}
                </span>
              </div>
              <p className="text-xs text-stone-600 leading-relaxed">
                {t('Akses fitur profesional aktif untuk akun ini. Seluruh fitur lokal dan naskah Anda tetap tersimpan privat di perangkat.')}
              </p>
              {entitlement.endsAt && (
                <p className="text-[11px] text-stone-500 mt-2">
                  {t('Berlaku hingga:')} {new Date(entitlement.endsAt).toLocaleDateString('id-ID', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-stone-200 text-stone-700">
                    <HardDrive className="size-4" aria-hidden="true" />
                  </span>
                  <span className="text-sm font-semibold text-stone-900">{t('Catetin Free')}</span>
                </div>
                <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                  entitlement?.status === 'pending'
                    ? 'bg-amber-100 text-amber-800'
                    : 'text-stone-600 bg-stone-200/80'
                }`}>
                  {entitlement?.status === 'pending' ? t('Segera aktif') : t('Aktif selamanya')}
                </span>
              </div>
              <p className="text-xs text-stone-600 leading-relaxed">
                {entitlement?.status === 'pending'
                  ? t('Paket Pro dijadwalkan aktif pada masa mendatang. Saat ini Anda menggunakan paket Free.')
                  : t('Paket Free aktif. Transkripsi lokal tanpa kuota cloud, mengikuti batas pengaman format dan perangkat.')}
              </p>
              {entitlement?.status === 'pending' && entitlement.startsAt && (
                <p className="text-[11px] text-stone-500 mt-2">
                  {t('Mulai aktif:')} {new Date(entitlement.startsAt).toLocaleDateString('id-ID', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
              )}
              <div className="mt-3 pt-3 border-t border-stone-200/60 flex items-center justify-between">
                <span className="text-[11px] text-stone-500">
                  {t('Ingin fitur editorial lanjutan?')}
                </span>
                {onOpenPricing ? (
                  <button
                    type="button"
                    onClick={onOpenPricing}
                    className="text-xs font-semibold text-[#172f49] hover:underline"
                  >
                    {t('Pelajari paket Pro')} &rarr;
                  </button>
                ) : (
                  <a
                    href="#pricing"
                    className="text-xs font-semibold text-[#172f49] hover:underline"
                  >
                    {t('Pelajari paket Pro')} &rarr;
                  </a>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Section 2: Ringkasan Penggunaan Cloud (Requirement 5: Separate error from empty) */}
        <section className="account-section bg-white p-6 rounded-2xl border border-stone-200 shadow-xs">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-stone-900">{t('Ringkasan Penggunaan')}</h2>
            <p className="text-xs text-stone-500 mt-0.5">
              {t(
                'Hitungan aktivitas ini mencatat total penggunaan Anda untuk sinkronisasi riwayat lintas perangkat, tanpa menyimpan naskah atau rekaman suara.'
              )}
            </p>
          </div>

          {summaryStatus === 'loading' ? (
            <div className="py-8 text-center text-stone-400" aria-busy="true">
              <Loader2 className="size-5 animate-spin mx-auto mb-2" aria-hidden="true" />
              <span className="text-xs">{t('Memuat ringkasan penggunaan...')}</span>
            </div>
          ) : summaryStatus === 'error' ? (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
                <span>{summaryError || t('Gagal memuat ringkasan penggunaan.')}</span>
              </div>
              {onRetrySummary && (
                <button
                  type="button"
                  onClick={onRetrySummary}
                  className="account-btn px-2.5 py-1 text-xs font-medium text-amber-900 border border-amber-300 rounded-md hover:bg-amber-100"
                >
                  {t('Coba lagi')}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Cloud Usage Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-stone-50 border border-stone-100 flex items-center gap-3">
                  <div className="size-10 rounded-lg bg-emerald-100/60 text-emerald-700 flex items-center justify-center shrink-0">
                    <FileAudio className="size-5" aria-hidden="true" />
                  </div>
                  <div>
                    <span className="block text-2xl font-semibold text-stone-900 font-mono">
                      {totals.local_transcription_completed}
                    </span>
                    <span className="text-xs text-stone-500">{t('Transkripsi selesai')}</span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-stone-50 border border-stone-100 flex items-center gap-3">
                  <div className="size-10 rounded-lg bg-blue-100/60 text-blue-700 flex items-center justify-center shrink-0">
                    <FileText className="size-5" aria-hidden="true" />
                  </div>
                  <div>
                    <span className="block text-2xl font-semibold text-stone-900 font-mono">
                      {totals.transcript_export_completed}
                    </span>
                    <span className="text-xs text-stone-500">{t('Ekspor naskah')}</span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-stone-50 border border-stone-100 flex items-center gap-3">
                  <div className="size-10 rounded-lg bg-amber-100/60 text-amber-700 flex items-center justify-center shrink-0">
                    <Archive className="size-5" aria-hidden="true" />
                  </div>
                  <div>
                    <span className="block text-2xl font-semibold text-stone-900 font-mono">
                      {totals.catetin_backup_completed}
                    </span>
                    <span className="text-xs text-stone-500">{t('Backup arsip')}</span>
                  </div>
                </div>
              </div>

              {/* Recent Activity List */}
              <div>
                <h3 className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-2">
                  {t('Aktivitas Terbaru')}
                </h3>
                {hasActivity ? (
                  <ul className="divide-y divide-stone-100 border border-stone-100 rounded-xl overflow-hidden text-xs">
                    {summary?.usage?.recentDaily.map((item, idx) => {
                      const labelMap: Record<string, string> = {
                        local_transcription_completed: t('Transkripsi lokal selesai'),
                        transcript_export_completed: t('Ekspor naskah selesai'),
                        catetin_backup_completed: t('Backup arsip selesai'),
                      };
                      return (
                        <li key={idx} className="p-3 flex items-center justify-between bg-white hover:bg-stone-50">
                          <span className="font-medium text-stone-700">
                            {labelMap[item.eventType] || item.eventType}
                          </span>
                          <div className="flex items-center gap-4 text-stone-500">
                            <span className="font-mono bg-stone-100 px-2 py-0.5 rounded text-stone-800">
                              {item.count}x
                            </span>
                            <span className="font-mono">{item.usageDate}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="p-4 rounded-xl bg-stone-50 text-center text-xs text-stone-500">
                    {t('Belum ada riwayat aktivitas. Jalankan transkripsi, ekspor naskah, atau backup arsip untuk melihat riwayat di sini.')}
                  </div>
                )}
              </div>

              {/* Local Workspace Isolation Section */}
              {localStats && (
                <div className="p-4 rounded-xl bg-stone-50/70 border border-stone-200/80">
                  <div className="flex items-center gap-2 mb-2 text-stone-800 text-xs font-medium">
                    <HardDrive className="size-4 text-stone-500" aria-hidden="true" />
                    <span>{t('Di perangkat ini (hanya di peramban ini)')}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-stone-500 block">{t('Proyek:')}</span>
                      <span className="font-mono font-medium text-stone-800">{localStats.projectCount}</span>
                    </div>
                    <div>
                      <span className="text-stone-500 block">{t('Rekaman:')}</span>
                      <span className="font-mono font-medium text-stone-800">{localStats.recordingCount}</span>
                    </div>
                    <div>
                      <span className="text-stone-500 block">{t('Total Durasi:')}</span>
                      <span className="font-mono font-medium text-stone-800">
                        {Math.round(localStats.totalDurationSec / 60)} {t('menit')}
                      </span>
                    </div>
                  </div>
                  <p className="text-2xs text-stone-400 mt-2">
                    {t('Statistik lokal ini tidak diunggah ke cloud dan hanya dihitung dari IndexedDB peramban Anda saat ini.')}
                  </p>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Section 3: Sesi Aktif (Requirement 5: Separate error from empty) */}
        <section className="account-section bg-white p-6 rounded-2xl border border-stone-200 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-base font-semibold text-stone-900">{t('Kelola Sesi')}</h2>
              <p className="text-xs text-stone-500 mt-0.5">
                {t('Daftar perangkat dan peramban yang sedang aktif masuk ke akun Anda.')}
              </p>
            </div>
            {otherSessions.length > 0 && sessionsStatus === 'success' && (
              <button
                type="button"
                onClick={handleRevokeOthers}
                disabled={busy}
                className="account-btn inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-stone-200 text-stone-700 hover:bg-stone-50 text-xs font-medium transition-colors"
                aria-label={t('Keluar dari perangkat lain')}
              >
                <LogOut className="size-3.5" aria-hidden="true" />
                <span>{t('Keluar dari perangkat lain')}</span>
              </button>
            )}
          </div>

          {sessionsStatus === 'loading' ? (
            <div className="py-6 text-center text-stone-400" aria-busy="true">
              <Loader2 className="size-5 animate-spin mx-auto mb-2" aria-hidden="true" />
              <span className="text-xs">{t('Memuat sesi...')}</span>
            </div>
          ) : sessionsStatus === 'error' ? (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
                <span>{sessionsError || t('Gagal memuat daftar sesi.')}</span>
              </div>
              {onRetrySessions && (
                <button
                  type="button"
                  onClick={onRetrySessions}
                  className="account-btn px-2.5 py-1 text-xs font-medium text-amber-900 border border-amber-300 rounded-md hover:bg-amber-100"
                >
                  {t('Coba lagi')}
                </button>
              )}
            </div>
          ) : sessions.length === 0 ? (
            <div className="p-4 rounded-xl bg-stone-50 text-center text-xs text-stone-500">
              {t('Tidak ada sesi yang terdaftar.')}
            </div>
          ) : (
            <ul className="divide-y divide-stone-100 border border-stone-100 rounded-xl overflow-hidden text-xs">
              {sessions.map((sess) => {
                const isCurrent = sess.id === currentSessionId;
                const uaInfo = humanizeUserAgent(sess.userAgent);
                const IconComponent = uaInfo.os === 'iOS' || uaInfo.os === 'Android' ? Smartphone : Laptop;
                const isTokenRevoking = sess.token ? inFlightTokens.has(sess.token) : false;

                return (
                  <li
                    key={sess.id}
                    className={`p-4 flex items-center justify-between gap-4 ${
                      isCurrent ? 'bg-stone-50/50' : 'bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="size-9 rounded-lg bg-stone-100 flex items-center justify-center text-stone-600 shrink-0">
                        <IconComponent className="size-4" aria-hidden="true" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-stone-800">{uaInfo.label}</span>
                          {isCurrent ? (
                            <span className="bg-emerald-100 text-emerald-800 text-2xs font-semibold px-2 py-0.5 rounded-full">
                              {t('Perangkat ini')}
                            </span>
                          ) : (
                            <span className="bg-stone-100 text-stone-600 text-2xs px-2 py-0.5 rounded-full">
                              {t('Perangkat lain')}
                            </span>
                          )}
                        </div>
                        <span className="text-stone-400 text-2xs block mt-0.5 font-mono">
                          {sess.createdAt ? new Date(sess.createdAt).toLocaleDateString('id-ID', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          }) : ''}
                        </span>
                      </div>
                    </div>

                    {!isCurrent && sess.token && (
                      <button
                        type="button"
                        onClick={() => handleRevokeSingle(sess.token!)}
                        disabled={busy || isTokenRevoking}
                        className="account-btn px-2.5 py-1 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-md transition-colors inline-flex items-center gap-1"
                        aria-label={t('Keluarkan sesi ini')}
                      >
                        {isTokenRevoking && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
                        <span>{t('Keluarkan')}</span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Section 4: Zona Bahaya */}
        <section className="account-section bg-rose-50/30 p-6 rounded-2xl border border-rose-200/60">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-rose-900">{t('Hapus Akun Cloud')}</h2>
              <p className="text-xs text-stone-600 mt-1 max-w-xl leading-relaxed">
                {t(
                  'Menghapus akun cloud akan menghapus data profil, sesi aktif, dan riwayat hitungan cloud Anda secara permanen. Rekaman audio, transkrip, dan proyek lokal di perangkat ini TIDAK akan dihapus dan tetap aman tersimpan di peramban Anda.'
                )}
              </p>
            </div>
            <button
              ref={deleteTriggerRef}
              type="button"
              onClick={() => {
                setDeleteConfirmOpen(true);
              }}
              disabled={busy}
              className="account-btn inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-semibold shrink-0 transition-colors"
              aria-label={t('Hapus Akun Cloud')}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              <span>{t('Hapus Akun Cloud')}</span>
            </button>
          </div>
        </section>
      </div>

      {/* Requirement 6: Accessible Radix Dialog with Focus Trap, Escape, and Initial Focus on Cancel */}
      <Dialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          if (busy) return; // Prevent closing while in flight
          setDeleteConfirmOpen(open);
        }}
      >
        <DialogContent
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            cancelButtonRef.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            deleteTriggerRef.current?.focus();
          }}
          onPointerDownOutside={(e) => {
            if (busy) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('Konfirmasi Hapus Akun Cloud')}</DialogTitle>
            <DialogDescription>
              {t(
                'Tindakan ini akan menghapus data profil akun Google Anda dan riwayat hitungan di server Catetin secara permanen.'
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="p-3 my-2 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-800">
            <strong>{t('Data lokal aman:')}</strong>{' '}
            {t('Seluruh rekaman suara, transkrip, draf, dan proyek di perangkat ini TIDAK akan dihapus.')}
          </div>

          <div className="flex items-center justify-end gap-3 mt-4">
            <button
              ref={cancelButtonRef}
              type="button"
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={busy}
              className="account-btn px-4 py-2 rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-50 text-sm font-medium"
            >
              {t('Batal')}
            </button>
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={busy}
              className="account-btn inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 text-white hover:bg-rose-700 text-sm font-medium transition-colors"
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              <span>{t('Ya, Hapus Akun Saya')}</span>
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}

export interface AccountCenterProps {
  session: UseAccountSessionResult;
  onBack: () => void;
  onOpenPricing?: () => void;
  localStats?: {
    projectCount: number;
    recordingCount: number;
    totalDurationSec: number;
  };
}

export function AccountCenter({ session, onBack, onOpenPricing, localStats }: AccountCenterProps) {
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [summaryStatus, setSummaryStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<AccountSessionItem[]>([]);
  const [sessionsStatus, setSessionsStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const [entitlement, setEntitlement] = useState<AccountEntitlement | null>(null);
  const [entitlementStatus, setEntitlementStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [entitlementError, setEntitlementError] = useState<string | null>(null);

  // Request generation tokens & session tracking to prevent deferred stale responses
  const sessionEpochRef = useRef(0);
  const summaryReqRef = useRef(0);
  const sessionsReqRef = useRef(0);
  const entitlementReqRef = useRef(0);
  const unmountedRef = useRef(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const currentUserId = session.user?.id;
  const currentSessionId = session.sessionId;

  // Immediate reset when unauthenticated or user changes
  useEffect(() => {
    if (session.status !== 'authenticated' || !currentUserId) {
      sessionEpochRef.current++;
      setSummary(null);
      setSummaryStatus(session.status === 'loading' ? 'loading' : 'success');
      setSummaryError(null);
      setSessions([]);
      setSessionsStatus(session.status === 'loading' ? 'loading' : 'success');
      setSessionsError(null);
      setEntitlement(null);
      setEntitlementStatus(session.status === 'loading' ? 'loading' : 'success');
      setEntitlementError(null);
    }
  }, [session.status, currentUserId]);

  const loadSummary = useCallback(async () => {
    if (session.status !== 'authenticated' || !session.user?.id) return;
    const reqEpoch = sessionEpochRef.current;
    const reqToken = ++summaryReqRef.current;
    const reqUserId = session.user.id;
    const reqSessionId = session.sessionId;

    setSummaryStatus('loading');
    setSummaryError(null);

    const res = await fetchAccountSummary();

    // Stale response guard: discard if generation changed, unmounted, or session identity changed
    if (
      unmountedRef.current ||
      sessionEpochRef.current !== reqEpoch ||
      summaryReqRef.current !== reqToken ||
      sessionRef.current.status !== 'authenticated' ||
      sessionRef.current.user?.id !== reqUserId ||
      sessionRef.current.sessionId !== reqSessionId
    ) {
      return;
    }

    if (res.status === 'success') {
      setSummary(res.data);
      setSummaryStatus('success');
    } else if (res.status === 'error') {
      setSummaryError(res.message);
      setSummaryStatus('error');
    } else {
      setSummary(null);
      setSummaryStatus('error');
    }
  }, [session.status, session.user?.id, session.sessionId]);

  const loadSessions = useCallback(async () => {
    if (session.status !== 'authenticated' || !session.user?.id) return;
    const reqEpoch = sessionEpochRef.current;
    const reqToken = ++sessionsReqRef.current;
    const reqUserId = session.user.id;
    const reqSessionId = session.sessionId;

    setSessionsStatus('loading');
    setSessionsError(null);

    const res = await listUserSessions();

    // Stale response guard: discard if generation changed, unmounted, or session identity changed
    if (
      unmountedRef.current ||
      sessionEpochRef.current !== reqEpoch ||
      sessionsReqRef.current !== reqToken ||
      sessionRef.current.status !== 'authenticated' ||
      sessionRef.current.user?.id !== reqUserId ||
      sessionRef.current.sessionId !== reqSessionId
    ) {
      return;
    }

    if (res.status === 'success') {
      setSessions(res.data);
      setSessionsStatus('success');
    } else if (res.status === 'error') {
      setSessionsError(res.message);
      setSessionsStatus('error');
    } else {
      setSessions([]);
      setSessionsStatus('error');
    }
  }, [session.status, session.user?.id, session.sessionId]);

  const loadEntitlement = useCallback(async () => {
    if (session.status !== 'authenticated' || !session.user?.id) return;
    const reqEpoch = sessionEpochRef.current;
    const reqToken = ++entitlementReqRef.current;
    const reqUserId = session.user.id;
    const reqSessionId = session.sessionId;

    setEntitlementStatus('loading');
    setEntitlementError(null);

    const res = await fetchAccountEntitlement();

    // Stale response guard: discard if generation changed, unmounted, or session identity changed
    if (
      unmountedRef.current ||
      sessionEpochRef.current !== reqEpoch ||
      entitlementReqRef.current !== reqToken ||
      sessionRef.current.status !== 'authenticated' ||
      sessionRef.current.user?.id !== reqUserId ||
      sessionRef.current.sessionId !== reqSessionId
    ) {
      return;
    }

    if (res.status === 'success') {
      setEntitlement(res.data);
      setEntitlementStatus('success');
    } else if (res.status === 'error') {
      setEntitlementError(res.message);
      setEntitlementStatus('error');
    } else {
      setEntitlement(null);
      setEntitlementStatus('error');
    }
  }, [session.status, session.user?.id, session.sessionId]);

  const loadAll = useCallback(async () => {
    await Promise.all([loadSummary(), loadSessions(), loadEntitlement()]);
  }, [loadSummary, loadSessions, loadEntitlement]);

  useEffect(() => {
    unmountedRef.current = false;
    if (session.status === 'authenticated' && session.user?.id) {
      void loadAll();
    }
    return () => {
      unmountedRef.current = true;
      sessionEpochRef.current++;
    };
  }, [session.status, session.user?.id, session.sessionId, loadAll]);

  const handleRevokeOtherSessions = async () => {
    const ok = await revokeOtherUserSessions();
    if (ok) {
      await loadSessions();
    } else {
      throw new Error('revoke_others_failed');
    }
  };

  const handleRevokeSession = async (token: string) => {
    const ok = await revokeSingleSession(token);
    if (ok) {
      await loadSessions();
    } else {
      throw new Error('revoke_session_failed');
    }
  };

  const handleDeleteAccount = async () => {
    const ok = await deleteCloudAccount();
    if (ok) {
      await session.refresh();
      onBack();
    } else {
      throw new Error('delete_account_failed');
    }
  };

  return (
    <AccountCenterView
      status={session.status}
      user={session.user}
      currentSessionId={session.sessionId}
      summaryStatus={summaryStatus}
      summary={summary}
      summaryError={summaryError}
      entitlementStatus={entitlementStatus}
      entitlement={entitlement}
      entitlementError={entitlementError}
      sessionsStatus={sessionsStatus}
      sessions={sessions}
      sessionsError={sessionsError}
      localStats={localStats}
      onBack={onBack}
      onSignOut={session.signOut}
      onRevokeOtherSessions={handleRevokeOtherSessions}
      onRevokeSession={handleRevokeSession}
      onDeleteAccount={handleDeleteAccount}
      onRetry={session.refresh}
      onRetrySummary={loadSummary}
      onRetrySessions={loadSessions}
      onRetryEntitlement={loadEntitlement}
      onOpenPricing={onOpenPricing}
      onSignIn={session.signInWithGoogle}
    />
  );
}

export function StandaloneAccountCenter(props: Omit<AccountCenterProps, 'session'>) {
  const session = useAccountSession();
  return <AccountCenter {...props} session={session} />;
}
