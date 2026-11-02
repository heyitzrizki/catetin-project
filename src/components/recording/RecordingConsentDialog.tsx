import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Shield, AlertCircle, Loader2 } from 'lucide-react';
import { t } from '@/lib/i18n';
import type { BrowserCapabilities } from '@/features/recording/recording-types';
import { getRecordingErrorMessage } from '@/features/recording/recording-error-messages';

interface RecordingConsentDialogProps {
  open: boolean;
  capabilities: BrowserCapabilities;
  isRequestingPermission?: boolean;
  onOpenChange: (open: boolean) => void;
  onProceed: () => void;
}

export const RecordingConsentDialog: React.FC<RecordingConsentDialogProps> = ({
  open,
  capabilities,
  isRequestingPermission = false,
  onOpenChange,
  onProceed,
}) => {
  const [hasInformedParticipants, setHasInformedParticipants] = useState(false);

  // IMPORTANT 5: Always reset participant acknowledgement when dialog opens or closes
  useEffect(() => {
    setHasInformedParticipants(false);
  }, [open]);

  const isSupported = capabilities.supported && capabilities.isSecureContext;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setHasInformedParticipants(false);
    }
    onOpenChange(nextOpen);
  };

  const handleProceed = () => {
    if (!hasInformedParticipants || !isSupported || isRequestingPermission) return;
    onProceed();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(e) => {
          const checkbox = document.getElementById('consent-checkbox');
          if (checkbox) {
            e.preventDefault();
            checkbox.focus();
          }
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-[var(--accent)] text-[var(--primary)] grid place-items-center flex-shrink-0">
              <Shield className="size-4" aria-hidden="true" />
            </div>
            <DialogTitle className="text-lg font-semibold text-[var(--foreground)]">
              {t('Rekam pertemuan di perangkat ini')}
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-[var(--muted-foreground)] leading-relaxed mt-2">
            {t(
              'Catetin menggunakan mikrofon untuk merekam percakapan. Audio dan transkrip tetap tersimpan di perangkat ini dan tidak dikirim ke server.'
            )}
          </DialogDescription>
        </DialogHeader>

        {!isSupported && (
          <div className="p-3.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5 my-1" role="alert">
            <AlertCircle className="size-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <strong className="block font-semibold">
                {capabilities.isSecureContext ? t('Peramban belum didukung') : t('Konteks tidak aman')}
              </strong>
              <p className="mt-0.5 leading-relaxed">
                {!capabilities.isSecureContext
                  ? getRecordingErrorMessage('insecure-context')
                  : getRecordingErrorMessage('unsupported-browser')}
              </p>
            </div>
          </div>
        )}

        <div className="space-y-3.5 my-2">
          <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--background)]">
            <p className="text-xs text-[var(--foreground)] leading-relaxed font-medium">
              {t('Pastikan semua peserta mengetahui dan menyetujui perekaman.')}
            </p>
          </div>

          <label
            htmlFor="consent-checkbox"
            className="flex items-start gap-3 cursor-pointer p-2 rounded-md hover:bg-[var(--accent)] transition-colors"
          >
            <input
              id="consent-checkbox"
              type="checkbox"
              checked={hasInformedParticipants}
              onChange={(e) => setHasInformedParticipants(e.target.checked)}
              disabled={!isSupported || isRequestingPermission}
              className="mt-1 h-4 w-4 rounded border-border text-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            />
            <span className="text-xs font-normal text-[var(--foreground)] leading-relaxed select-none">
              {t('Saya sudah memberi tahu peserta bahwa pertemuan ini direkam.')}
            </span>
          </label>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isRequestingPermission}
            onClick={() => handleOpenChange(false)}
            className="min-h-[44px]"
          >
            {t('Batal')}
          </Button>
          <Button
            type="button"
            disabled={!hasInformedParticipants || !isSupported || isRequestingPermission}
            aria-busy={isRequestingPermission}
            onClick={handleProceed}
            className="min-h-[44px] gap-2"
          >
            {isRequestingPermission && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            <span>{t('Lanjut pilih mikrofon')}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
