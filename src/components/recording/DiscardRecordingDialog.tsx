import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { t } from '@/lib/i18n';

interface DiscardRecordingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  cancelLabel?: string;
  confirmLabel?: string;
  onConfirm: () => void;
}

export const DiscardRecordingDialog: React.FC<DiscardRecordingDialogProps> = ({
  open,
  onOpenChange,
  title = t('Batalkan rekaman?'),
  description = t('Audio yang belum diselesaikan akan dihapus dari draft lokal.'),
  cancelLabel = t('Lanjut merekam'),
  confirmLabel = t('Batalkan dan hapus'),
  onConfirm,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(e) => {
          // Strictly avoid initial focus on destructive button!
          const keepBtn = document.getElementById('discard-dialog-cancel-btn');
          if (keepBtn) {
            e.preventDefault();
            keepBtn.focus();
          }
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 grid place-items-center flex-shrink-0">
              <AlertTriangle className="size-4" aria-hidden="true" />
            </div>
            <DialogTitle className="text-lg font-semibold text-[var(--foreground)]">
              {title}
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-[var(--muted-foreground)] leading-relaxed mt-1">
            {description}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-2 mt-2">
          {/* Default/Keep Button has initial focus */}
          <Button
            id="discard-dialog-cancel-btn"
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="min-h-[44px]"
          >
            {cancelLabel}
          </Button>
          {/* Destructive Button */}
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
            className="min-h-[44px]"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
