import { t } from '@/lib/i18n';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Copy, Download, FileText, Captions } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ExportActions {
  onExportWord: () => void;
  onExportTxt: () => void;
  onExportSrt: () => void;
  onCopyAll: () => void;
}

export function ExportMenu({ onExportWord, onExportTxt, onExportSrt, onCopyAll, disabled = false }: ExportActions & { disabled?: boolean }) {
  return <Dropdown.Root>
    <Dropdown.Trigger asChild><Button variant="outline" disabled={disabled}><Download aria-hidden="true" /><span>{t("Ekspor")}</span><ChevronDown className="size-3.5" aria-hidden="true" /></Button></Dropdown.Trigger>
    <Dropdown.Portal><Dropdown.Content className="menu-content" align="end" sideOffset={8} collisionPadding={16}>
      <Dropdown.Label className="menu-label">{t("Bawa naskah Anda")}</Dropdown.Label>
      <Dropdown.Item className="menu-item" onSelect={onExportTxt}><FileText aria-hidden="true" />{t("Teks polos")}<span className="menu-extension">.txt</span></Dropdown.Item>
      <Dropdown.Item className="menu-item" onSelect={onExportWord}><FileText aria-hidden="true" />{t("Dokumen Word")}<span className="menu-extension">.doc</span></Dropdown.Item>
      <Dropdown.Item className="menu-item" onSelect={onExportSrt}><Captions aria-hidden="true" />{t("Subtitle")}<span className="menu-extension">.srt</span></Dropdown.Item>
      <Dropdown.Separator className="menu-separator" />
      <Dropdown.Item className="menu-item" onSelect={onCopyAll}><Copy aria-hidden="true" />{t("Salin naskah")}</Dropdown.Item>
    </Dropdown.Content></Dropdown.Portal>
  </Dropdown.Root>;
}
