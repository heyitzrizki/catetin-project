import React, { useState } from 'react';
import { Folder } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import type { FolderRecord } from '@/features/workspace/workspace-store';

export interface MoveFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recordingTitle: string;
  currentFolderId: string | null;
  folders: FolderRecord[];
  onSelectFolder: (folderId: string | null) => Promise<void>;
}

export function MoveFolderDialog({
  open,
  onOpenChange,
  recordingTitle,
  currentFolderId,
  folders,
  onSelectFolder,
}: MoveFolderDialogProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(currentFolderId);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    setSelectedFolderId(currentFolderId);
  }, [currentFolderId, open]);

  const handleSave = async () => {
    setLoading(true);
    try {
      await onSelectFolder(selectedFolderId);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Pindahkan ke folder')}</DialogTitle>
          <DialogDescription>
            {recordingTitle ? `${recordingTitle}` : t('Pilih folder tujuan untuk rekaman ini.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 mt-2">
          <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
            {/* Tanpa folder option */}
            <button
              type="button"
              onClick={() => setSelectedFolderId(null)}
              className={`flex items-center gap-3 p-3 rounded-md border text-left text-sm transition-colors min-h-[44px] ${
                selectedFolderId === null
                  ? 'border-[var(--primary)] bg-[var(--accent)] font-semibold text-[var(--primary)]'
                  : 'border-[var(--border)] bg-[var(--card)] hover:bg-[var(--accent)] text-[var(--foreground)]'
              }`}
            >
              <Folder className="size-4 opacity-50" aria-hidden="true" />
              <span>{t('Tanpa folder')}</span>
            </button>

            {/* Folder list */}
            {folders.map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelectedFolderId(f.id)}
                className={`flex items-center gap-3 p-3 rounded-md border text-left text-sm transition-colors min-h-[44px] ${
                  selectedFolderId === f.id
                    ? 'border-[var(--primary)] bg-[var(--accent)] font-semibold text-[var(--primary)]'
                    : 'border-[var(--border)] bg-[var(--card)] hover:bg-[var(--accent)] text-[var(--foreground)]'
                }`}
              >
                <Folder className="size-4 text-[var(--primary)]" aria-hidden="true" />
                <span className="truncate">{f.name}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="min-h-[44px]"
            >
              {t('Batalkan')}
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={loading}
              className="min-h-[44px]"
            >
              {t('Pindahkan')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

