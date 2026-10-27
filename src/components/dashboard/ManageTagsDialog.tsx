import React, { useEffect, useState } from 'react';
import { Plus, Tag, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { cleanTags, normalizeTag } from '@/features/workspace/workspace-store';

export interface ManageTagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recordingTitle: string;
  initialTags?: string[];
  allWorkspaceTags?: string[];
  onSave: (tags: string[]) => Promise<void>;
}

export function ManageTagsDialog({
  open,
  onOpenChange,
  recordingTitle,
  initialTags = [],
  allWorkspaceTags = [],
  onSave,
}: ManageTagsDialogProps) {
  const [currentTags, setCurrentTags] = useState<string[]>(initialTags);
  const [inputVal, setInputVal] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setCurrentTags(cleanTags(initialTags));
    setInputVal('');
  }, [initialTags, open]);

  const addTag = (tagToAdd: string) => {
    const clean = normalizeTag(tagToAdd);
    if (!clean) return;
    const exists = currentTags.some(t => t.toLowerCase() === clean.toLowerCase());
    if (!exists) {
      setCurrentTags(prev => [...prev, clean]);
    }
    setInputVal('');
  };

  const removeTag = (tagToRemove: string) => {
    setCurrentTags(prev => prev.filter(t => t.toLowerCase() !== tagToRemove.toLowerCase()));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag(inputVal);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await onSave(cleanTags(currentTags));
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  // Filter suggestion tags that are not already selected
  const suggestions = allWorkspaceTags.filter(
    s => !currentTags.some(c => c.toLowerCase() === s.toLowerCase()),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Atur tag')}</DialogTitle>
          <DialogDescription>
            {recordingTitle ? `${recordingTitle}` : t('Kelompokkan rekaman dengan label kata kunci.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 mt-2">
          {/* Active Tags */}
          <div className="flex flex-wrap gap-2 min-h-[38px] p-2 bg-[var(--background)] border border-[var(--border)] rounded-md items-center">
            {currentTags.length === 0 ? (
              <span className="text-xs text-[var(--muted-foreground)]">
                {t('Belum ada tag pada rekaman ini.')}
              </span>
            ) : (
              currentTags.map(tag => (
                <span
                  key={tag.toLowerCase()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--accent)] text-[var(--primary)] border border-[var(--border)]"
                >
                  <Tag className="size-3" aria-hidden="true" />
                  <span>{tag}</span>
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    aria-label={`${t('Hapus tag')} ${tag}`}
                    className="hover:text-[var(--destructive)] focus-visible:outline-none"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </span>
              ))
            )}
          </div>

          {/* Add Tag Input */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('Ketik tag lalu tekan Enter')}
              className="flex-1 px-3 py-2 text-sm rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] min-h-[44px]"
              maxLength={40}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => addTag(inputVal)}
              disabled={!inputVal.trim()}
              className="min-h-[44px] gap-1.5"
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('Tambah tag')}
            </Button>
          </div>

          {/* Quick Suggestions from existing workspace tags */}
          {suggestions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-[var(--muted-foreground)] font-medium">
                {t('Pilih dari tag yang sudah ada:')}
              </span>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {suggestions.map(s => (
                  <button
                    key={s.toLowerCase()}
                    type="button"
                    onClick={() => addTag(s)}
                    className="text-xs px-2 py-0.5 rounded border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--accent)] text-[var(--foreground)] min-h-[28px] transition-colors"
                  >
                    +{s}
                  </button>
                ))}
              </div>
            </div>
          )}

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
              {t('Simpan')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

