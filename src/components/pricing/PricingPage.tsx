import { useState } from 'react';
import { Check, Sparkles, ArrowRight, ShieldCheck, Clock, HelpCircle, HardDrive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { FEATURE_CATALOG } from '@/features/account/feature-catalog';

export interface PricingPageProps {
  onOpenStudio: () => void;
  onGoHome: () => void;
}

export function PricingPage({ onOpenStudio, onGoHome }: PricingPageProps) {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('yearly');

  // Math: 12 months * Rp39.000 = Rp468.000 vs Rp349.000/year (honest savings: Rp119.000)
  const monthlyPrice = 39000;
  const yearlyPrice = 349000;
  const yearlyEquivalentMonthly = Math.round(yearlyPrice / 12);
  const yearlySavings = monthlyPrice * 12 - yearlyPrice; // Rp119.000

  return (
    <div className="pricing-page min-h-screen bg-[#fcfbf7] text-stone-900">
      {/* Main Content */}
      <main id="main-content" tabIndex={-1} className="page-container py-12 sm:py-16 px-4 sm:px-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-10 sm:mb-12">
          <p className="eyebrow text-xs font-semibold tracking-widest uppercase text-stone-500 mb-2">
            {t('PILIHAN PAKET')}
          </p>
          <h1 className="text-3xl sm:text-4xl font-serif text-stone-900 tracking-tight mb-3">
            {t('Transparan, jujur, dan tetap local-first.')}
          </h1>
          <p className="text-base text-stone-600 leading-relaxed">
            {t(
              'Seluruh fitur lokal yang ada hari ini tetap gratis selamanya. Paket Pro disiapkan untuk alur kerja editorial lanjutan.'
            )}
          </p>

          {/* Billing Cycle Selector */}
          <div className="mt-8 inline-flex items-center rounded-xl bg-stone-200/70 p-1 border border-stone-300/80 shadow-inner">
            <button
              type="button"
              role="radio"
              aria-checked={billingCycle === 'yearly'}
              onClick={() => setBillingCycle('yearly')}
              className={`px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-all flex items-center gap-1.5 ${
                billingCycle === 'yearly'
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <span>{t('Tahunan')}</span>
              <span className="inline-block text-[11px] font-semibold text-emerald-800 bg-emerald-100/90 px-2 py-0.5 rounded-full">
                {t('Hemat Rp119.000')}
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={billingCycle === 'monthly'}
              onClick={() => setBillingCycle('monthly')}
              className={`px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-all ${
                billingCycle === 'monthly'
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              {t('Bulanan')}
            </button>
          </div>
        </div>

        {/* Pricing Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 items-stretch mb-16">
          {/* FREE PLAN */}
          <div className="pricing-card rounded-2xl border border-stone-200 bg-white p-6 sm:p-8 flex flex-col justify-between shadow-sm relative">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                  {t('PAKET DASAR')}
                </span>
                <span className="text-xs font-medium text-stone-600 bg-stone-100 px-2.5 py-1 rounded-full">
                  {t('Aktif di perangkat')}
                </span>
              </div>
              <h2 className="text-2xl font-serif text-stone-900 mb-1">{t('Catetin Free')}</h2>
              <p className="text-xs sm:text-sm text-stone-600 mb-6 leading-relaxed">
                {t('Transkripsi lokal tanpa kuota cloud, mengikuti batas pengaman format dan perangkat.')}
              </p>

              <div className="mb-6 pb-6 border-b border-stone-100">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl sm:text-4xl font-bold text-stone-900">Rp0</span>
                  <span className="text-xs sm:text-sm text-stone-500">{t('/ selamanya')}</span>
                </div>
                <p className="text-xs text-stone-500 mt-1">
                  {t('Tidak memerlukan kartu kredit atau akun cloud untuk mulai.')}
                </p>
              </div>

              {/* Feature List */}
              <div className="space-y-3 mb-8">
                <p className="text-xs font-semibold text-stone-800 uppercase tracking-wider">
                  {t('Termasuk dalam Free:')}
                </p>
                <ul className="space-y-2.5 text-xs sm:text-sm text-stone-700">
                  <li className="flex items-start gap-2.5">
                    <Check className="size-4 shrink-0 text-emerald-600 mt-0.5" aria-hidden="true" />
                    <span>{t(FEATURE_CATALOG.local_workspace.name)}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check className="size-4 shrink-0 text-emerald-600 mt-0.5" aria-hidden="true" />
                    <span>{t(FEATURE_CATALOG.local_transcription.name)}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check className="size-4 shrink-0 text-emerald-600 mt-0.5" aria-hidden="true" />
                    <span>{t(FEATURE_CATALOG.standard_exports.name)}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check className="size-4 shrink-0 text-emerald-600 mt-0.5" aria-hidden="true" />
                    <span>{t(FEATURE_CATALOG.local_backup.name)}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check className="size-4 shrink-0 text-emerald-600 mt-0.5" aria-hidden="true" />
                    <span>{t('Dukungan percepatan GPU WebGPU dan WebAssembly')}</span>
                  </li>
                </ul>
              </div>
            </div>

            <Button
              size="lg"
              onClick={onOpenStudio}
              className="w-full bg-stone-900 hover:bg-stone-800 text-white font-medium py-3 rounded-xl transition-all"
            >
              {t('Buka Studio Sekarang')}
            </Button>
          </div>

          {/* PRO PLAN */}
          <div className="pricing-card rounded-2xl border-2 border-[#172f49] bg-white p-6 sm:p-8 flex flex-col justify-between shadow-md relative overflow-hidden">
            {/* Top Badge */}
            <div className="absolute top-0 right-0 bg-[#172f49] text-white text-[11px] font-semibold px-3 py-1 rounded-bl-xl tracking-wide">
              {t('Harga perkenalan')}
            </div>

            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#172f49] flex items-center gap-1">
                  <Sparkles className="size-3.5 text-amber-500" aria-hidden="true" />
                  {t('UNTUK PROFESIONAL')}
                </span>
              </div>
              <h2 className="text-2xl font-serif text-stone-900 mb-1">{t('Catetin Pro')}</h2>
              <p className="text-xs sm:text-sm text-stone-600 mb-6 leading-relaxed">
                {t(
                  'Dirancang untuk jurnalis, peneliti, podcaster, dan tim konten yang membutuhkan produktivitas naskah tingkat lanjut.'
                )}
              </p>

              <div className="mb-6 pb-6 border-b border-stone-100">
                {billingCycle === 'yearly' ? (
                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-3xl sm:text-4xl font-bold text-stone-900">Rp349.000</span>
                      <span className="text-xs sm:text-sm text-stone-500">{t('/ tahun')}</span>
                    </div>
                    <p className="text-xs text-stone-500 mt-1">
                      {t('Setara dengan')} <strong className="text-stone-700">Rp{yearlyEquivalentMonthly.toLocaleString('id-ID')}/bln</strong>. {t('Hemat Rp119.000 per tahun dibanding pembayaran bulanan.')}
                    </p>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-3xl sm:text-4xl font-bold text-stone-900">Rp39.000</span>
                      <span className="text-xs sm:text-sm text-stone-500">{t('/ bulan')}</span>
                    </div>
                    <p className="text-xs text-stone-500 mt-1">
                      {t('Dibayar setiap bulan. Dapat dibatalkan kapan saja setelah pembelian dibuka.')}
                    </p>
                  </div>
                )}
              </div>

              {/* Feature List */}
              <div className="space-y-3 mb-8">
                <p className="text-xs font-semibold text-stone-800 uppercase tracking-wider">
                  {t('Semua fitur Free, ditambah:')}
                </p>
                <ul className="space-y-2.5 text-xs sm:text-sm text-stone-700">
                  <li className="flex items-start gap-2.5">
                    <Check className="size-4 shrink-0 text-[#172f49] mt-0.5" aria-hidden="true" />
                    <div>
                      <span className="font-medium text-stone-900">{t(FEATURE_CATALOG.transcript_templates.name)}</span>
                      <span className="ml-1.5 text-[11px] font-medium text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                        {t('Segera hadir')}
                      </span>
                    </div>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check className="size-4 shrink-0 text-[#172f49] mt-0.5" aria-hidden="true" />
                    <div>
                      <span className="font-medium text-stone-900">{t(FEATURE_CATALOG.advanced_export_profiles.name)}</span>
                      <span className="ml-1.5 text-[11px] font-medium text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                        {t('Segera hadir')}
                      </span>
                    </div>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check className="size-4 shrink-0 text-[#172f49] mt-0.5" aria-hidden="true" />
                    <div>
                      <span className="font-medium text-stone-900">{t(FEATURE_CATALOG.priority_support.name)}</span>
                      <span className="ml-1.5 text-[11px] font-medium text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                        {t('Segera hadir')}
                      </span>
                    </div>
                  </li>
                  <li className="flex items-start gap-2.5 text-stone-500">
                    <Clock className="size-4 shrink-0 text-stone-400 mt-0.5" aria-hidden="true" />
                    <div>
                      <span>{t(FEATURE_CATALOG.batch_transcription.name)}</span>
                      <span className="ml-1.5 text-[11px] text-stone-400">({t('Direncanakan')})</span>
                    </div>
                  </li>
                  <li className="flex items-start gap-2.5 text-stone-500">
                    <Clock className="size-4 shrink-0 text-stone-400 mt-0.5" aria-hidden="true" />
                    <div>
                      <span>{t(FEATURE_CATALOG.advanced_speaker_tools.name)}</span>
                      <span className="ml-1.5 text-[11px] text-stone-400">({t('Direncanakan')})</span>
                    </div>
                  </li>
                  <li className="flex items-start gap-2.5 text-stone-500">
                    <Clock className="size-4 shrink-0 text-stone-400 mt-0.5" aria-hidden="true" />
                    <div>
                      <span>{t(FEATURE_CATALOG.google_drive_import.name)}</span>
                      <span className="ml-1.5 text-[11px] text-stone-400">({t('Direncanakan')})</span>
                    </div>
                  </li>
                  <li className="flex items-start gap-2.5 text-stone-500">
                    <Clock className="size-4 shrink-0 text-stone-400 mt-0.5" aria-hidden="true" />
                    <div>
                      <span>{t(FEATURE_CATALOG.optional_cloud_assist.name)}</span>
                      <span className="ml-1.5 text-[11px] text-stone-400">({t('Direncanakan')})</span>
                    </div>
                  </li>
                </ul>
              </div>
            </div>

            <div>
              <Button
                size="lg"
                disabled
                className="w-full bg-stone-200 text-stone-500 font-medium py-3 rounded-xl cursor-not-allowed border border-stone-300/80"
                aria-disabled="true"
              >
                {t('Pro Belum Dibuka')}
              </Button>
              <p className="text-[11px] text-stone-500 text-center mt-2 leading-relaxed">
                {t(
                  'Pembelian paket Pro belum dibuka pada tahap ini. Anda tidak perlu membayar atau memasukkan data apa pun sekarang.'
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Local-first Guarantee Banner */}
        <div className="rounded-2xl bg-amber-50/70 border border-amber-200/80 p-6 sm:p-8 text-stone-800">
          <div className="flex items-start gap-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-stone-900">
                {t('Komitmen Privasi Local-First Catetin')}
              </h3>
              <p className="text-xs sm:text-sm text-stone-600 leading-relaxed">
                {t(
                  'Baik Anda menggunakan paket Free maupun Pro di masa depan, rekaman audio, transkrip teks, judul project, dan catatan Anda tetap diproses dan disimpan secara privat di perangkat Anda sendiri.'
                )}
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
