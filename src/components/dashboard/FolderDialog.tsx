import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

export interface FolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId?: string | null;
  initialName?: string;
  onSubmit: (name: string) => Promise<void>;
}

export function FolderDialog({
  open,
  onOpenChange,
  folderId,
  initialName = '',
  onSubmit,
}: FolderDialogProps) {
  const [name, setName] = useState(initialName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setName(initialName);
    setError('');
  }, [initialName, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    setLoading(true);
    setError('');
    try {
      await onSubmit(clean);
      setName('');
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Gagal menyimpan folder.'));
    } finally {
      setLoading(false);
    }
  };

  const isEditing = Boolean(folderId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? t('Ganti nama folder') : t('Buat folder baru')}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? t('Ubah nama folder ini tanpa memengaruhi rekaman di dalamnya.')
              : t('Folder satu tingkat untuk mengelompokkan rekaman dalam project ini.')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="folder-name-input" className="text-xs font-semibold text-[var(--foreground)]">
              {t('Nama folder')}
            </label>
            <input
              id="folder-name-input"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('Contoh: Wawancara Narasumber, Bab 1')}
              className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-[var(--primary)] min-h-[44px]"
              autoFocus
              disabled={loading}
              maxLength={60}
            />
            {error && <p className="form-error text-xs text-[var(--destructive)]" role="alert">{error}</p>}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
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
              type="submit"
              disabled={!name.trim() || loading}
              className="min-h-[44px]"
            >
              {isEditing ? t('Simpan') : t('Buat folder baru')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

