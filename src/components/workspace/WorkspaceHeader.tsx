import { t } from '@/lib/i18n';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Check, FileAudio, Search, Upload, SlidersHorizontal } from 'lucide-react';
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
}

export function WorkspaceHeader({ activeSample, availableRecordings, onSelectSample, onUploadClick, searchQuery, onSearchChange, onOpenTools, isCustom, canExport, ...exports }: WorkspaceHeaderProps) {
  return <header className="workspace-toolbar">
    <div className="workspace-file-row">
      <div className="file-heading"><span className="file-icon"><FileAudio aria-hidden="true" /></span><div className="min-w-0"><p className="document-label">{isCustom ? t("Rekaman Anda") : t("Contoh transkrip")}</p><h1 title={activeSample.filename}>{t(activeSample.title)}</h1></div></div>
      <div className="file-actions"><Button onClick={onUploadClick}><Upload aria-hidden="true" /><span>{t("Pilih audio")}</span></Button><ExportMenu {...exports} disabled={!canExport} /></div>
    </div>
    <div className="workspace-command-row">
      <Dropdown.Root><Dropdown.Trigger asChild><Button variant="ghost" className="sample-switcher">{t("Ganti naskah")} <ChevronDown aria-hidden="true" /></Button></Dropdown.Trigger><Dropdown.Portal><Dropdown.Content className="menu-content" align="start" sideOffset={8} collisionPadding={16}><Dropdown.Label className="menu-label">{t("Naskah dalam sesi ini")}</Dropdown.Label>{availableRecordings.map(item => <Dropdown.Item className="menu-item" key={item.id} onSelect={() => onSelectSample(item.id)}><FileAudio aria-hidden="true" /><span className="truncate">{t(item.title)}</span>{activeSample.id === item.id && <Check className="ml-auto" aria-hidden="true" />}</Dropdown.Item>)}</Dropdown.Content></Dropdown.Portal></Dropdown.Root>
      <div className="workspace-search"><Search className="size-4" aria-hidden="true" /><Input id="transcript-search" type="search" aria-label={t("Cari dalam naskah")} placeholder={t("Cari dalam naskah…")} value={searchQuery} onChange={event => onSearchChange(event.target.value)} /></div>
      <Button variant="outline" className="mobile-tools" onClick={onOpenTools}><SlidersHorizontal aria-hidden="true" /><span>{t("Alat naskah")}</span></Button>
    </div>
  </header>;
}
