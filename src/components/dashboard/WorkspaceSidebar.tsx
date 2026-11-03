import React from 'react';
import {
  AudioLines,
  Check,
  Database,
  Download,
  Folder,
  HardDrive,
  Home,
  PanelLeftClose,
  PanelLeftOpen,
  Tags,
  UploadCloud,
  UserRound,
  X,
} from 'lucide-react';
import { t } from '@/lib/i18n';
import type { StorageEstimateInfo, StoragePersistenceStatus } from '@/features/workspace/storage-adapter';

export type WorkspaceSectionId = 'workspace' | 'projects' | 'recordings' | 'folders-tags' | 'storage';

export interface WorkspaceSidebarProps {
  activeSection: WorkspaceSectionId;
  onSelectSection: (section: WorkspaceSectionId) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  storageEstimate?: StorageEstimateInfo;
  persistenceStatus?: StoragePersistenceStatus;
  onOpenAccount?: () => void;
  onExportWorkspace?: () => void;
  onImportBackup?: () => void;
}

export const WorkspaceSidebar: React.FC<WorkspaceSidebarProps> = ({
  activeSection,
  onSelectSection,
  collapsed = false,
  onToggleCollapse,
  mobileOpen = false,
  onMobileClose,
  storageEstimate,
  onOpenAccount,
  onExportWorkspace,
  onImportBackup,
}) => {
  const navItems: Array<{
    id: WorkspaceSectionId;
    label: string;
    icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  }> = [
    { id: 'workspace', label: t('Workspace'), icon: Home },
    { id: 'projects', label: t('Projects'), icon: Folder },
    { id: 'recordings', label: t('Rekaman'), icon: AudioLines },
    { id: 'folders-tags', label: t('Folder & tag'), icon: Tags },
    { id: 'storage', label: t('Penyimpanan'), icon: Database },
  ];

  const handleSelect = (id: WorkspaceSectionId) => {
    onSelectSection(id);
    if (mobileOpen && onMobileClose) {
      onMobileClose();
    }
  };

  const handleAccountClick = () => {
    if (onOpenAccount) {
      onOpenAccount();
    } else if (typeof window !== 'undefined') {
      window.location.hash = 'account';
    }
    if (mobileOpen && onMobileClose) {
      onMobileClose();
    }
  };

  const usagePercent =
    storageEstimate?.supported && typeof storageEstimate.usagePercent === 'number'
      ? Math.max(4, Math.min(100, storageEstimate.usagePercent))
      : 16;

  const usageSubtext =
    storageEstimate?.supported && storageEstimate.usageFormatted !== '-' && storageEstimate.quotaFormatted !== '-'
      ? `${storageEstimate.usageFormatted} ${t('dari')} ${storageEstimate.quotaFormatted}`
      : t('Tersimpan di browser perangkat ini');

  const renderSidebarContent = (isDrawer = false) => {
    const isCompact = !isDrawer && collapsed;
    return (
      <div className="workspace-sidebar-inner flex flex-col justify-between h-full bg-[#172F49] text-[#F5F2EA] select-none">
        <div>
          {/* Brand Header */}
          <div className="workspace-sidebar-brand flex items-center justify-between px-4 pt-5 pb-4">
            <div className="flex items-center min-w-0">
              <img
                src="/brand/catetin-lockup-reversed.svg"
                alt=""
                aria-hidden="true"
                width={108}
                height={34}
                className={`h-[30px] w-auto select-none ${isCompact ? 'hidden' : 'block'}`}
                draggable={false}
              />
              <img
                src="/brand/catetin-mark-reversed.svg"
                alt=""
                aria-hidden="true"
                width={28}
                height={28}
                className={`h-7 w-7 select-none ${isCompact ? 'block' : 'hidden'}`}
                draggable={false}
              />
              <span className="sr-only">Catetin</span>
            </div>

            {isDrawer && onMobileClose ? (
              <button
                type="button"
                data-testid="workspace-drawer-close"
                onClick={onMobileClose}
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-[#CFE2F1] hover:bg-[#223E5E] hover:text-white focus-visible:outline-2 focus-visible:outline-[#CFE2F1]"
                aria-label={t('Tutup navigasi')}
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            ) : onToggleCollapse ? (
              <button
                type="button"
                data-testid="workspace-sidebar-collapse-toggle"
                onClick={onToggleCollapse}
                className="hidden md:inline-flex lg:hidden items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-[#CFE2F1] hover:bg-[#223E5E] hover:text-white focus-visible:outline-2 focus-visible:outline-[#CFE2F1]"
                aria-label={isCompact ? t('Perluas navigasi') : t('Padatkan navigasi')}
                title={isCompact ? t('Perluas navigasi') : t('Padatkan navigasi')}
              >
                {isCompact ? (
                  <PanelLeftOpen className="size-4" aria-hidden="true" />
                ) : (
                  <PanelLeftClose className="size-4" aria-hidden="true" />
                )}
              </button>
            ) : null}
          </div>

          {/* Primary Navigation */}
          <nav aria-label={t('Navigasi workspace')} className="px-2.5 space-y-1">
            {navItems.map(item => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-nav-id={item.id}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => handleSelect(item.id)}
                  title={isCompact ? item.label : undefined}
                  className={`w-full min-h-[44px] flex items-center ${
                    isCompact ? 'justify-center px-2' : 'justify-start px-3.5 gap-3'
                  } rounded-xl text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[#CFE2F1] ${
                    isActive
                      ? 'bg-[#D7E6F5] text-[#172F49] font-semibold shadow-xs'
                      : 'text-[#E3ECF5] hover:bg-[#213D5B] hover:text-white'
                  }`}
                >
                  <Icon
                    className={`size-4 shrink-0 ${isActive ? 'text-[#172F49]' : 'text-[#CFE2F1]'}`}
                    aria-hidden="true"
                  />
                  {!isCompact && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Utility: Account, Storage, Backup */}
        <div className="px-2.5 pb-4 pt-4 space-y-2 border-t border-[#264566]">
          <button
            type="button"
            data-nav-id="account"
            onClick={handleAccountClick}
            title={isCompact ? t('Account') : undefined}
            className={`w-full min-h-[44px] flex items-center ${
              isCompact ? 'justify-center px-2' : 'justify-start px-3.5 gap-3'
            } rounded-xl text-[13px] font-medium text-[#E3ECF5] hover:bg-[#213D5B] hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-[#CFE2F1]`}
          >
            <UserRound className="size-4 shrink-0 text-[#CFE2F1]" aria-hidden="true" />
            {!isCompact && <span className="truncate">{t('Account')}</span>}
          </button>

          {/* Local Storage Status */}
          <button
            type="button"
            onClick={() => handleSelect('storage')}
            className={`w-full text-left rounded-xl p-3 bg-[#12263C] hover:bg-[#1D3652] border border-[#274666] transition-colors min-h-[44px] focus-visible:outline-2 focus-visible:outline-[#CFE2F1] ${
              isCompact ? 'flex items-center justify-center' : 'block'
            }`}
            title={t('Penyimpanan lokal')}
          >
            {isCompact ? (
              <HardDrive className="size-4 text-[#CFE2F1]" aria-hidden="true" />
            ) : (
              <div className="space-y-2">
                <div className="flex items-start gap-2.5">
                  <HardDrive className="size-4 text-[#CFE2F1] shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-[#F5F2EA] truncate">
                      {t('Penyimpanan lokal')}
                    </span>
                    <span className="block text-[11px] text-[#B7C9DC] truncate mt-0.5">
                      {usageSubtext}
                    </span>
                  </div>
                </div>
                <div className="w-full h-1.5 rounded-full bg-[#24415E] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#5D9CE6]"
                    style={{ width: `${usagePercent}%` }}
                  />
                </div>
              </div>
            )}
          </button>

          {/* Backup Status & Quick Export/Import */}
          <div
            className={`rounded-xl p-3 bg-[#12263C] border border-[#274666] ${
              isCompact ? 'flex items-center justify-center' : 'space-y-2.5'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 inline-flex items-center justify-center shrink-0">
                <Check className="size-3" aria-hidden="true" />
              </span>
              {!isCompact && (
                <div className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-[#F5F2EA] truncate">
                    {t('Backup siap')}
                  </span>
                  <span className="block text-[11px] text-[#B7C9DC] truncate">
                    {t('Tersimpan lokal')}
                  </span>
                </div>
              )}
            </div>

            {!isCompact && (onExportWorkspace || onImportBackup) && (
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                {onExportWorkspace && (
                  <button
                    type="button"
                    onClick={onExportWorkspace}
                    className="min-h-[44px] px-2 py-1.5 rounded-lg bg-[#1C3652] hover:bg-[#254567] text-[#E3ECF5] text-[11px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-[#CFE2F1]"
                  >
                    <Download className="size-3.5 shrink-0 text-[#CFE2F1]" aria-hidden="true" />
                    <span className="truncate">{t('Export')}</span>
                  </button>
                )}
                {onImportBackup && (
                  <button
                    type="button"
                    onClick={onImportBackup}
                    className="min-h-[44px] px-2 py-1.5 rounded-lg bg-[#1C3652] hover:bg-[#254567] text-[#E3ECF5] text-[11px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-[#CFE2F1]"
                  >
                    <UploadCloud className="size-3.5 shrink-0 text-[#CFE2F1]" aria-hidden="true" />
                    <span className="truncate">{t('Import')}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Desktop / Tablet Persistent Rail */}
      <aside
        data-testid="workspace-sidebar"
        data-sidebar-collapsed={collapsed ? 'true' : 'false'}
        aria-label={t('Sidebar workspace')}
        className={`workspace-sidebar-rail hidden md:block shrink-0 bg-[#172F49] border-r border-[#12263C] transition-[width] duration-200 ${
          collapsed ? 'w-[72px]' : 'w-[220px]'
        }`}
      >
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden flex"
          role="dialog"
          aria-modal="true"
          aria-label={t('Navigasi workspace')}
        >
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs"
            onClick={onMobileClose}
            aria-hidden="true"
          />
          <div className="relative z-10 w-[264px] max-w-[82vw] h-full bg-[#172F49] shadow-xl">
            {renderSidebarContent(true)}
          </div>
        </div>
      )}
    </>
  );
};
