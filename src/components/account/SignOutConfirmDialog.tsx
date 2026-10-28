import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { AlertCircle, Loader2, LogOut } from 'lucide-react';

export interface SignOutConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<{ success: true } | void> | { success: true } | void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

export function SignOutConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  triggerRef,
}: SignOutConfirmDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const inFlightRef = useRef(false);

  // Reset state whenever the dialog opens or closes
  useEffect(() => {
    if (open) {
      setError(null);
      setIsSubmitting(false);
      inFlightRef.current = false;
    }
  }, [open]);

  const handleConfirm = useCallback(async () => {
    // Prevent double-submit / concurrent clicks
    if (inFlightRef.current || isSubmitting) return;

    inFlightRef.current = true;
    setIsSubmitting(true);
    setError(null);

    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Gagal keluar dari akun. Silakan coba lagi.')
      );
    } finally {
      inFlightRef.current = false;
      setIsSubmitting(false);
    }
  }, [onConfirm, onOpenChange, isSubmitting]);

  const handleCancel = useCallback(() => {
    if (isSubmitting) return;
    onOpenChange(false);
  }, [isSubmitting, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={isSubmitting ? () => {} : onOpenChange}>
      <DialogContent
        className="max-w-md p-6"
        onOpenAutoFocus={(event) => {
          // Requirement: Initial focus MUST be on "Batal"
          event.preventDefault();
          cancelButtonRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          // Requirement: Restore focus to trigger element
          if (triggerRef?.current && triggerRef.current.isConnected) {
            event.preventDefault();
            triggerRef.current.focus();
          }
        }}
      >
        <DialogHeader className="gap-2 sm:text-left">
          <div className="flex items-center gap-2.5 text-stone-900">
            <span className="flex size-9 items-center justify-center rounded-full bg-stone-100 text-stone-700">
              <LogOut className="size-4" aria-hidden="true" />
            </span>
            <DialogTitle className="text-base font-semibold">
              {t('Konfirmasi keluar')}
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-stone-600 leading-relaxed pt-1">
            {t(
              'Keluar hanya mengakhiri sesi akun di peramban ini. Rekaman, transkrip, dan project di perangkat Anda tetap tersimpan aman di penyimpanan lokal.'
            )}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div
            className="flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700"
            role="alert"
          >
            <AlertCircle className="size-4 shrink-0 text-rose-600" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter className="mt-4 gap-2 sm:gap-2">
          <Button
            ref={cancelButtonRef}
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={isSubmitting}
            className="w-full sm:w-auto"
          >
            {t('Batal')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="w-full sm:w-auto gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <span>{t('Memproses...')}</span>
              </>
            ) : (
              <span>{t('Keluar dari akun')}</span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
