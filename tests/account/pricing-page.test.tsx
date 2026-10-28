import { win } from './dom-setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { PricingPage } from '../../src/components/pricing/PricingPage.tsx';
import { FEATURE_CATALOG, getFeaturesByTier } from '../../src/features/account/feature-catalog.ts';
import { AccountCenterView, type AccountCenterViewProps } from '../../src/components/account/AccountCenter.tsx';
import { setLanguage } from '../../src/lib/i18n.ts';

function createMockViewProps(overrides?: Partial<AccountCenterViewProps>): AccountCenterViewProps {
  return {
    status: 'authenticated',
    user: {
      id: 'u_test_1',
      name: 'Rizki Anwar',
      email: 'anwar@example.com',
      image: null,
    },
    currentSessionId: 's_current',
    summaryStatus: 'success',
    summary: {
      user: {
        id: 'u_test_1',
        name: 'Rizki Anwar',
        email: 'anwar@example.com',
        image: null,
        createdAt: '2026-10-20T10:00:00Z',
      },
      usage: {
        totals: {
          local_transcription_completed: 5,
          transcript_export_completed: 2,
          catetin_backup_completed: 1,
        },
        recentDaily: [],
        totalCount: 8,
      },
    },
    sessionsStatus: 'success',
    sessions: [],
    localStats: {
      projectCount: 2,
      recordingCount: 4,
      totalDurationSec: 360,
    },
    actionBusy: false,
    onBack: () => {},
    onSignOut: () => {},
    onRevokeOtherSessions: async () => {},
    onRevokeSession: async () => {},
    onDeleteAccount: async () => {},
    onRetry: () => {},
    onRetrySummary: () => {},
    onRetrySessions: () => {},
    onSignIn: () => {},
    ...overrides,
  };
}

test('feature catalog: struktur konsisten dan membedakan status available vs planned', () => {
  const freeFeatures = getFeaturesByTier('free');
  const proFeatures = getFeaturesByTier('pro');

  assert.ok(freeFeatures.length >= 4, 'Tier Free harus memiliki minimal 4 fitur');
  assert.ok(proFeatures.length >= 4, 'Tier Pro harus memiliki minimal 4 fitur');

  // Semua fitur Free saat ini wajib berstatus available
  for (const feat of freeFeatures) {
    assert.equal(feat.availability, 'available', `Fitur Free ${feat.id} harus available`);
    assert.equal(feat.tier, 'free');
  }

  // Sebagian fitur Pro direncanakan (planned)
  const plannedPro = proFeatures.filter((f) => f.availability === 'planned');
  assert.ok(plannedPro.length >= 3, 'Tier Pro harus menandai fitur cloud masa depan sebagai planned');
});

test('PricingPage: merender paket Free dan Pro dengan harga yang jujur', () => {
  const html = renderToString(<PricingPage onOpenStudio={() => {}} onGoHome={() => {}} />);

  // Judul dan keterangan
  assert.ok(html.includes('PILIHAN PAKET'));
  assert.ok(html.includes('Transparan, jujur, dan tetap local-first.'));

  // Tier Free
  assert.ok(html.includes('Catetin Free'));
  assert.ok(html.includes('Rp0'));
  assert.ok(html.includes('/ selamanya'));

  // Tier Pro perkenalan
  assert.ok(html.includes('Catetin Pro'));
  assert.ok(html.includes('Harga perkenalan'));
  // Default billing tahunan menampilkan Rp349.000 / tahun dan penghematan Rp119.000 / tahun
  assert.ok(html.includes('349.000'));
  assert.ok(html.includes('Hemat Rp119.000'));

  // Jaminan privasi
  assert.ok(html.includes('Komitmen Privasi Local-First Catetin'));
  assert.ok(html.includes('diproses dan disimpan secara privat di perangkat Anda sendiri'));
});

test('PricingPage: tombol Pro disabled dan tidak melakukan transaksi atau checkout palsu', () => {
  const html = renderToString(<PricingPage onOpenStudio={() => {}} onGoHome={() => {}} />);

  // Tombol Pro harus disabled
  assert.ok(html.includes('Pro Belum Dibuka'));
  assert.ok(html.includes('disabled=""') || html.includes('disabled'));
  assert.ok(html.includes('Pembelian paket Pro belum dibuka'));

  // Tidak boleh ada form pembayaran atau kata kunci pembayaran palsu
  assert.equal(html.includes('midtrans'), false);
  assert.equal(html.includes('checkout'), false);
  assert.equal(html.includes('cart'), false);
});

test('PricingPage: tombol Free mengarah ke Studio', () => {
  const html = renderToString(<PricingPage onOpenStudio={() => {}} onGoHome={() => {}} />);

  assert.ok(html.includes('Buka Studio Sekarang'));
});

test('PricingPage: fitur direncanakan memiliki badge Segera hadir atau Direncanakan', () => {
  const html = renderToString(<PricingPage onOpenStudio={() => {}} onGoHome={() => {}} />);

  // Harus ada badge Segera hadir dan Direncanakan
  assert.ok(html.includes('Segera hadir'));
  assert.ok(html.includes('Direncanakan'));
  assert.ok(html.includes(FEATURE_CATALOG.transcript_templates.name));
  assert.ok(html.includes(FEATURE_CATALOG.batch_transcription.name));
});

test('AccountCenterView: menampilkan status Paket Akun Free dengan benar', () => {
  const props = createMockViewProps({
    entitlementStatus: 'success',
    entitlement: {
      plan: 'free',
      status: 'none',
      startsAt: null,
      endsAt: null,
      source: null,
      serverNow: '2026-10-28T10:00:00Z',
      features: ['local_workspace', 'local_transcription', 'standard_exports', 'local_backup'],
    },
  });

  const html = renderToString(<AccountCenterView {...props} />);

  assert.ok(html.includes('Paket Akun'));
  assert.ok(html.includes('Catetin Free'));
  assert.ok(html.includes('Aktif selamanya'));
  assert.ok(html.includes('Pelajari paket Pro'));
});

test('AccountCenterView: menampilkan status Paket Akun Pro aktif', () => {
  const props = createMockViewProps({
    entitlementStatus: 'success',
    entitlement: {
      plan: 'pro',
      status: 'active',
      startsAt: '2026-10-28T00:00:00Z',
      endsAt: '2027-10-28T00:00:00Z',
      source: 'promotion',
      serverNow: '2026-10-28T10:00:00Z',
      features: ['local_workspace', 'local_transcription', 'standard_exports', 'local_backup'],
    },
  });

  const html = renderToString(<AccountCenterView {...props} />);

  assert.ok(html.includes('Paket Akun'));
  assert.ok(html.includes('Catetin Pro'));
  assert.ok(html.includes('Aktif'));
  assert.ok(html.includes('Berlaku hingga:'));
});

test('AccountCenterView: penanganan status loading dan error pada entitlement', () => {
  // Loading state
  const loadingProps = createMockViewProps({
    entitlementStatus: 'loading',
  });
  const loadingHtml = renderToString(<AccountCenterView {...loadingProps} />);
  assert.ok(loadingHtml.includes('Memuat status paket...'));

  // Error state
  const errorProps = createMockViewProps({
    entitlementStatus: 'error',
    entitlementError: 'Gagal memuat status paket akun.',
    onRetryEntitlement: () => {},
  });
  const errorHtml = renderToString(<AccountCenterView {...errorProps} />);
  assert.ok(errorHtml.includes('Gagal memuat status paket akun.'));
  assert.ok(errorHtml.includes('Coba lagi'));
  // Kegagalan entitlement tidak mengganggu akses studio atau identitas akun
  assert.ok(errorHtml.includes('Pusat Akun'));
});

test('copy jujur: pricing dan account center tidak mengklaim durasi lokal tanpa batas', () => {
  setLanguage('id');
  const pricingHtml = renderToString(<PricingPage onOpenStudio={() => {}} onGoHome={() => {}} />);
  const accountProps = createMockViewProps({
    entitlementStatus: 'success',
    entitlement: {
      plan: 'free',
      status: 'none',
      startsAt: null,
      endsAt: null,
      source: null,
      serverNow: '2026-10-28T10:00:00Z',
      features: ['local_workspace', 'local_transcription', 'standard_exports', 'local_backup'],
    },
  });
  const accountHtml = renderToString(<AccountCenterView {...accountProps} />);

  // Dilarang mengklaim "tanpa batas durasi lokal"
  assert.equal(pricingHtml.includes('tanpa batas durasi lokal'), false);
  assert.equal(accountHtml.includes('tanpa batas durasi lokal'), false);

  // Wajib memakai copy jujur yang disepakati
  assert.ok(pricingHtml.includes('Transkripsi lokal tanpa kuota cloud, mengikuti batas pengaman format dan perangkat.'));
  assert.ok(accountHtml.includes('Transkripsi lokal tanpa kuota cloud, mengikuti batas pengaman format dan perangkat.'));
});

test('bilingual pricing: daftar fitur diterjemahkan dengan benar saat bahasa diubah ke English', () => {
  // Test English
  setLanguage('en');
  const enHtml = renderToString(<PricingPage onOpenStudio={() => {}} onGoHome={() => {}} />);
  assert.ok(enHtml.includes('Local Workspace'), 'English feature name: Local Workspace');
  assert.ok(enHtml.includes('On-Device Whisper Transcription'), 'English feature name: On-Device Whisper');
  assert.ok(enHtml.includes('Standard Exports'), 'English feature name: Standard Exports');
  assert.ok(enHtml.includes('Transcript Templates'), 'English feature name: Transcript Templates');
  assert.ok(enHtml.includes('Advanced Export Profiles'), 'English feature name: Advanced Export Profiles');
  assert.ok(enHtml.includes('Optional Cloud Assistance'), 'English feature name: Optional Cloud Assistance');
  assert.ok(enHtml.includes('Coming soon'), 'Badge Segera hadir harus Coming soon dalam English');
  assert.ok(enHtml.includes('Planned'), 'Badge Direncanakan harus Planned dalam English');

  // Kembalikan ke Indonesian
  setLanguage('id');
  const idHtml = renderToString(<PricingPage onOpenStudio={() => {}} onGoHome={() => {}} />);
  assert.ok(idHtml.includes('Ruang Kerja Lokal'), 'Indonesian feature name: Ruang Kerja Lokal');
  assert.ok(idHtml.includes('Transkripsi Whisper di Perangkat'), 'Indonesian feature name: Transkripsi Whisper');
  assert.ok(idHtml.includes('Template Naskah'), 'Indonesian feature name: Template Naskah');
  assert.ok(idHtml.includes('Bantuan Cloud Opsional'), 'Indonesian feature name: Bantuan Cloud Opsional');
  assert.ok(idHtml.includes('Segera hadir'), 'Indonesian badge: Segera hadir');
  assert.ok(idHtml.includes('Direncanakan'), 'Indonesian badge: Direncanakan');
});
