import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

export interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateProject: (title: string) => Promise<void>;
}

export function NewProjectDialog({ open, onOpenChange, onCreateProject }: NewProjectDialogProps) {
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = title.trim();
    if (!clean) return;
    setLoading(true);
    setError('');
    try {
      await onCreateProject(clean);
      setTitle('');
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Gagal membuat project.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Buat project baru')}</DialogTitle>
          <DialogDescription>
            {t('Kelompokkan beberapa rekaman dan naskah percakapan dalam satu project lokal.')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="project-title-input" className="text-xs font-semibold text-[var(--foreground)]">
              {t('Nama project')}
            </label>
            <input
              id="project-title-input"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('Contoh: Wawancara Riset, Rapat Tim')}
              className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-[var(--primary)] min-h-[44px]"
              autoFocus
              disabled={loading}
              maxLength={80}
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
              disabled={!title.trim() || loading}
              className="min-h-[44px]"
            >
              {t('Buat project')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
