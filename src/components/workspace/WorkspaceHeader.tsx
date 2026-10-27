import { t } from '@/lib/i18n';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Check, FileAudio, Folder, Search, Upload, SlidersHorizontal, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ExportMenu, type ExportActions } from '@/components/ui/export-menu';
import type { Recording } from '@/lib/transcript';

interface WorkspaceHeaderProps extends ExportActions {
  activeSample: Recording;
  availableRecordings: Recording[];
  onSelectSample: (key: string) => void;
  onUploadClick: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onOpenTools: () => void;
  isCustom: boolean;
  canExport: boolean;
  folderName?: string | null;
  tags?: string[];
  onOpenFolderModal?: () => void;
  onOpenTagsModal?: () => void;
}

export function WorkspaceHeader({
  activeSample,
  availableRecordings,
  onSelectSample,
  onUploadClick,
  searchQuery,
  onSearchChange,
  onOpenTools,
  isCustom,
  canExport,
  folderName,
  tags = [],
  onOpenFolderModal,
  onOpenTagsModal,
  ...exports
}: WorkspaceHeaderProps) {
  return (
    <header className="workspace-toolbar">
      <div className="workspace-file-row">
        <div className="file-heading">
          <span className="file-icon"><FileAudio aria-hidden="true" /></span>
          <div className="file-heading-copy min-w-0">
            <div className="file-title-group">
              <h1 title={activeSample.filename}>{t(activeSample.title)}</h1>
              <span className="document-badge">{isCustom ? t('Rekaman lokal') : t('Contoh naskah')}</span>
            </div>
            {isCustom && (
              <div className="flex items-center gap-1.5 flex-wrap mt-1">
                {folderName ? (
                  <button
                    type="button"
                    onClick={onOpenFolderModal}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-[var(--muted)] text-[var(--foreground)] hover:bg-[var(--accent)] border border-[var(--border)] transition-colors min-h-[26px]"
                    title={t('Pindahkan ke folder')}
                  >
                    <Folder className="size-3 text-[var(--primary)]" aria-hidden="true" />
                    <span>{folderName}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onOpenFolderModal}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-[var(--background)] text-[var(--muted-foreground)] hover:text-[var(--primary)] border border-dashed border-[var(--border)] transition-colors min-h-[26px]"
                    title={t('Pindahkan ke folder')}
                  >
                    <Folder className="size-3" aria-hidden="true" />
                    <span>+ {t('Folder')}</span>
                  </button>
                )}
                {tags.map(tg => (
                  <button
                    key={tg}
                    type="button"
                    onClick={onOpenTagsModal}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent)] text-[var(--primary)] font-medium border border-[var(--border)] hover:bg-[var(--card)] transition-colors min-h-[24px]"
                  >
                    #{tg}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={onOpenTagsModal}
                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:underline min-h-[24px]"
                >
                  <Tag className="size-2.5" aria-hidden="true" />
                  <span>{tags.length === 0 ? `+ ${t('Atur tag')}` : `+ ${t('Tag')}`}</span>
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="workspace-search">
          <Search className="size-4" aria-hidden="true" />
          <Input id="transcript-search" type="search" aria-label={t('Cari dalam naskah')} placeholder={t('Cari dalam naskah…')} value={searchQuery} onChange={event => onSearchChange(event.target.value)} />
        </div>
        <div className="file-actions">
          <Button className="toolbar-upload-btn" onClick={onUploadClick}><Upload aria-hidden="true" /><span>{t('Pilih audio')}</span></Button>
          <ExportMenu {...exports} disabled={!canExport} />
        </div>
      </div>
      <div className="workspace-command-row">
        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <Button variant="ghost" className="sample-switcher">{t('Ganti naskah')} <ChevronDown aria-hidden="true" /></Button>
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content className="menu-content" align="start" sideOffset={8} collisionPadding={16}>
              <Dropdown.Label className="menu-label">{t('Naskah dalam sesi ini')}</Dropdown.Label>
              {availableRecordings.map(item => (
                <Dropdown.Item className="menu-item" key={item.id} onSelect={() => onSelectSample(item.id)}>
                  <FileAudio aria-hidden="true" />
                  <span className="truncate">{t(item.title)}</span>
                  {activeSample.id === item.id && <Check className="ml-auto" aria-hidden="true" />}
                </Dropdown.Item>
              ))}
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
        <Button variant="outline" className="mobile-tools" onClick={onOpenTools}><SlidersHorizontal aria-hidden="true" /><span>{t('Alat naskah')}</span></Button>
      </div>
    </header>
  );
}
