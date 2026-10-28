import { win } from './dom-setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import ReactDOM from 'react-dom/client';
import { AccountCenterView, AccountCenter, type AccountCenterViewProps } from '../../src/components/account/AccountCenter.tsx';
import { AccountControl } from '../../src/components/account/AccountControl.tsx';
import type { UseAccountSessionResult } from '../../src/features/account/use-account-session.ts';

function cleanBody() {
  win.document.body.innerHTML = '';
}

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
        recentDaily: [
          { usageDate: '2026-10-28', eventType: 'local_transcription_completed', count: 3 },
          { usageDate: '2026-10-28', eventType: 'transcript_export_completed', count: 2 },
        ],
        totalCount: 8,
      },
    },
    sessionsStatus: 'success',
    sessions: [
      {
        id: 's_current',
        createdAt: '2026-10-28T00:00:00Z',
        expiresAt: '2026-11-04T00:00:00Z',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36',
      },
      {
        id: 's_other',
        token: 'tok_other',
        createdAt: '2026-10-27T10:00:00Z',
        expiresAt: '2026-11-03T10:00:00Z',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Safari/604.1',
      },
    ],
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

test('skip-link compatibility: seluruh state AccountCenterView merender main dengan id="main-content" dan tabIndex={-1}', () => {
  const loadingHtml = renderToString(<AccountCenterView {...createMockViewProps({ status: 'loading' })} />);
  assert.ok(loadingHtml.includes('id="main-content"'));
  assert.ok(loadingHtml.includes('tabindex="-1"'));

  const unavailableHtml = renderToString(<AccountCenterView {...createMockViewProps({ status: 'unavailable' })} />);
  assert.ok(unavailableHtml.includes('id="main-content"'));
  assert.ok(unavailableHtml.includes('tabindex="-1"'));

  const guestHtml = renderToString(<AccountCenterView {...createMockViewProps({ status: 'guest', user: null })} />);
  assert.ok(guestHtml.includes('id="main-content"'));
  assert.ok(guestHtml.includes('tabindex="-1"'));

  const authHtml = renderToString(<AccountCenterView {...createMockViewProps()} />);
  assert.ok(authHtml.includes('id="main-content"'));
  assert.ok(authHtml.includes('tabindex="-1"'));
});

test('AccountCenterView pada state loading menampilkan indikator pemuatan yang terstruktur', () => {
  const props = createMockViewProps({ status: 'loading' });
  const html = renderToString(<AccountCenterView {...props} />);
  assert.ok(html.includes('Memuat'));
  assert.ok(html.includes('aria-busy="true"'));
});

test('AccountCenterView pada state guest menampilkan ajakan masuk dan penjelasan local-first', () => {
  const props = createMockViewProps({ status: 'guest', user: null });
  const html = renderToString(<AccountCenterView {...props} />);
  assert.ok(html.includes('Masuk dengan Google') || html.includes('Masuk'));
  assert.ok(html.includes('Lokal') || html.includes('perangkat'));
});

test('AccountCenterView menampilkan profil pengguna, tanggal akun, dan jaminan local-first', () => {
  const props = createMockViewProps();
  const html = renderToString(<AccountCenterView {...props} />);
  assert.ok(html.includes('Rizki Anwar'));
  assert.ok(html.includes('anwar@example.com'));
  assert.ok(html.includes('Pusat Akun'));
  assert.ok(html.includes('perangkat lokal') || html.includes('di perangkat'));
});

test('AccountCenterView menampilkan ringkasan penggunaan cloud tanpa klaim kuota palsu dan empty state jujur', () => {
  const props = createMockViewProps();
  const html = renderToString(<AccountCenterView {...props} />);
  assert.ok(html.includes('Transkripsi selesai'));
  assert.ok(html.includes('5'));
  assert.ok(html.includes('Ekspor naskah'));
  assert.ok(html.includes('2'));
  assert.ok(html.includes('Backup arsip'));
  assert.ok(html.includes('1'));

  // Statistik lokal terpisah dengan label "Di perangkat ini"
  assert.ok(html.includes('Di perangkat ini'));

  // Test empty state jika totalCount 0
  const emptyProps = createMockViewProps({
    summary: {
      user: props.summary!.user,
      usage: {
        totals: { local_transcription_completed: 0, transcript_export_completed: 0, catetin_backup_completed: 0 },
        recentDaily: [],
        totalCount: 0,
      },
    },
  });
  const emptyHtml = renderToString(<AccountCenterView {...emptyProps} />);
  assert.ok(emptyHtml.includes('Belum ada riwayat aktivitas') || emptyHtml.includes('Belum ada aktivitas'));
});

test('pemisahan state error dan empty: kegagalan API menampilkan error dengan retry, bukan empty state palsu', () => {
  // 1. Summary error state
  const summaryErrorProps = createMockViewProps({
    summaryStatus: 'error',
    summaryError: 'Koneksi ke database terputus',
    summary: null,
  });
  const summaryErrorHtml = renderToString(<AccountCenterView {...summaryErrorProps} />);
  assert.ok(summaryErrorHtml.includes('Koneksi ke database terputus'), 'Harus menampilkan pesan error');
  assert.ok(summaryErrorHtml.includes('Coba lagi'), 'Harus ada tombol retry');
  assert.equal(summaryErrorHtml.includes('Belum ada riwayat aktivitas'), false, 'DILARANG menampilkan empty state saat error!');

  // 2. Sessions error state
  const sessionsErrorProps = createMockViewProps({
    sessionsStatus: 'error',
    sessionsError: 'Gagal mengambil sesi aktif',
    sessions: [],
  });
  const sessionsErrorHtml = renderToString(<AccountCenterView {...sessionsErrorProps} />);
  assert.ok(sessionsErrorHtml.includes('Gagal mengambil sesi aktif'), 'Harus menampilkan pesan error sesi');
  assert.ok(sessionsErrorHtml.includes('Coba lagi'), 'Harus ada tombol retry sesi');
  assert.equal(sessionsErrorHtml.includes('Tidak ada sesi yang terdaftar'), false, 'DILARANG menampilkan empty state saat error!');
});

test('AccountCenterView menampilkan sesi aktif, membedakan perangkat ini vs perangkat lain, dan tidak mengekspos raw IP', () => {
  const props = createMockViewProps();
  const html = renderToString(<AccountCenterView {...props} />);

  // Perangkat ini
  assert.ok(html.includes('Google Chrome di Windows'));
  assert.ok(html.includes('Perangkat ini') || html.includes('Sesi ini'));

  // Perangkat lain
  assert.ok(html.includes('Apple Safari di iOS'));
  assert.ok(html.includes('Keluar dari perangkat lain'));

  // TIDAK boleh menampilkan raw IP address
  assert.equal(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(html), false, 'Raw IP address dilarang tampil di UI');
});

test('AccountCenterView memiliki zona hapus akun dengan penjelasan eksplisit bahwa rekaman lokal aman', () => {
  const props = createMockViewProps();
  const html = renderToString(<AccountCenterView {...props} />);
  assert.ok(html.includes('Hapus Akun Cloud'));
  // Harus menjelaskan bahwa data lokal di browser TIDAK akan terhapus
  assert.ok(html.includes('TIDAK akan dihapus') || html.includes('tetap aman tersimpan di peramban'));
});

test('Cegah duplicate session hooks: rendering AccountControl dan AccountCenter dengan controlled session menghasilkan 0 getSession call', () => {
  const originalFetch = globalThis.fetch;
  let getSessionCount = 0;
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes('get-session')) {
      getSessionCount++;
    }
    return new Response(JSON.stringify(null));
  }) as any;

  try {
    const controlledSession: UseAccountSessionResult = {
      status: 'authenticated',
      user: { id: 'u_ctrl_1', name: 'Controlled User', email: 'ctrl@example.com', image: null },
      sessionId: 'sess_ctrl_1',
      error: null,
      refresh: async () => {},
      signInWithGoogle: async () => {},
      signOut: async () => ({ success: true as const }),
    };

    renderToString(
      <div>
        <AccountControl session={controlledSession} />
        <AccountCenter session={controlledSession} onBack={() => {}} />
      </div>
    );

    assert.equal(getSessionCount, 0, 'Controlled session dilarang memanggil get-session berulang secara internal');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Cegah stale account response: response deferred dari User A tidak boleh ditampilkan setelah user logout atau berganti akun', async () => {
  cleanBody();
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = ReactDOM.createRoot(container as any);

  let resolveUserAFetch: (val: any) => void;
  const userAFetchPromise = new Promise((resolve) => {
    resolveUserAFetch = resolve;
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes('/api/account/summary')) {
      return userAFetchPromise;
    }
    if (String(url).includes('/api/account/sessions')) {
      return new Response(JSON.stringify({ ok: true, sessions: [] }));
    }
    return new Response(JSON.stringify({ ok: true }));
  }) as any;

  try {
    const sessionUserA: UseAccountSessionResult = {
      status: 'authenticated',
      user: { id: 'user_A', name: 'User A', email: 'usera@example.com', image: null },
      sessionId: 'sess_A',
      error: null,
      refresh: async () => {},
      signInWithGoogle: async () => {},
      signOut: async () => ({ success: true as const }),
    };

    // 1. Render AccountCenter dengan User A
    root.render(<AccountCenter session={sessionUserA} onBack={() => {}} />);
    await new Promise((r) => setTimeout(r, 60));

    // 2. Sekarang User A logout (status berubah menjadi guest)
    const sessionGuest: UseAccountSessionResult = {
      status: 'guest',
      user: null,
      sessionId: null,
      error: null,
      refresh: async () => {},
      signInWithGoogle: async () => {},
      signOut: async () => ({ success: true as const }),
    };
    root.render(<AccountCenter session={sessionGuest} onBack={() => {}} />);
    await new Promise((r) => setTimeout(r, 60));

    // 3. Response lama dari User A selesai:
    resolveUserAFetch!(
      new Response(
        JSON.stringify({
          user: { id: 'user_A', name: 'User A Secret Name', email: 'usera@example.com', createdAt: '2026-10-01' },
          usage: { totals: { local_transcription_completed: 99 }, recentDaily: [], totalCount: 99 },
        })
      )
    );
    await new Promise((r) => setTimeout(r, 60));

    // 4. Data rahasia User A dilarang tampil
    const htmlAfterDeferred = container.innerHTML;
    assert.equal(htmlAfterDeferred.includes('User A Secret Name'), false, 'Data deferred User A dilarang tampil setelah logout');
    assert.equal(htmlAfterDeferred.includes('99'), false, 'Hitungan deferred User A dilarang tampil setelah logout');

    root.unmount();
    win.document.body.removeChild(container);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('DOM interaction tests: modal delete, initial focus pada Batal, Tab trap, Escape close, dan restore focus ke trigger', async () => {
  cleanBody();
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = ReactDOM.createRoot(container as any);

  const props = createMockViewProps();
  root.render(<AccountCenterView {...props} />);
  await new Promise((resolve) => setTimeout(resolve, 80));

  // 1. Trigger button
  const buttonsBefore = Array.from(win.document.querySelectorAll('button')) as any[];
  const triggerBtn = buttonsBefore.find((b) => b.textContent?.includes('Hapus Akun Cloud'));
  assert.ok(triggerBtn, 'Tombol trigger Hapus Akun Cloud harus ada');
  triggerBtn.focus();
  assert.equal(win.document.activeElement, triggerBtn);
  triggerBtn.click();

  await new Promise((resolve) => setTimeout(resolve, 80));

  // 2. Initial focus pada tombol Batal
  const buttons = Array.from(win.document.querySelectorAll('button')) as any[];
  const batalBtn = buttons.find((b) => b.textContent?.trim() === 'Batal');
  assert.ok(batalBtn, 'Tombol Batal harus ada di dalam dialog');
  assert.equal(win.document.activeElement, batalBtn, 'Initial focus wajib berada pada tombol Batal');

  // 3. Tab trap di dalam dialog: dari elemen focusable terakhir (tombol Tutup / X), Tab berputar ke tombol pertama (Batal)
  const tutupBtn = buttons.find((b) => b.textContent?.includes('Tutup'));
  assert.ok(tutupBtn, 'Tombol Tutup dialog harus ada');
  tutupBtn.focus();
  assert.equal(win.document.activeElement, tutupBtn);

  const tabEvent = new win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  tutupBtn.dispatchEvent(tabEvent as any);
  assert.equal(win.document.activeElement, batalBtn, 'Tab dari elemen terakhir wajib terperangkap kembali ke tombol Batal');

  // 4. Escape menutup dialog
  const dialogContent = win.document.querySelector('[role="dialog"]') as any;
  assert.ok(dialogContent, 'Elemen dialog harus ada saat terbuka');
  const escEvent = new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  dialogContent.dispatchEvent(escEvent as any);
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(win.document.querySelector('[role="dialog"]'), null, 'Dialog harus tertutup setelah Escape');

  // 5. Restore focus ke trigger
  assert.equal(win.document.activeElement, triggerBtn, 'Fokus wajib kembali ke trigger button setelah dialog ditutup');

  root.unmount();
  cleanBody();
});

test('DOM interaction tests: rapid double-click revoke session token yang sama menghasilkan tepat 1 callback action', async () => {
  cleanBody();
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = ReactDOM.createRoot(container as any);

  let revokeCallCount = 0;
  let resolveRevoke: () => void;
  const revokePromise = new Promise<void>((res) => {
    resolveRevoke = res;
  });

  const props = createMockViewProps({
    onRevokeSession: async () => {
      revokeCallCount++;
      await revokePromise;
    },
  });

  root.render(<AccountCenterView {...props} />);
  await new Promise((resolve) => setTimeout(resolve, 80));

  const buttons = Array.from(win.document.querySelectorAll('button')) as any[];
  const revokeBtn = buttons.find((b) => b.getAttribute('aria-label') === 'Keluarkan sesi ini');
  assert.ok(revokeBtn, 'Tombol revoke sesi harus ada');

  // Rapid double-click
  revokeBtn.click();
  revokeBtn.click();
  revokeBtn.click();

  assert.equal(revokeCallCount, 1, 'Rapid click pada token yang sama hanya boleh memicu tepat 1 callback action');

  resolveRevoke!();
  await new Promise((resolve) => setTimeout(resolve, 80));

  root.unmount();
  win.document.body.removeChild(container);
});

test('konkurensi: tiga loader paralel (summary, sessions, entitlement) semuanya sukses dan tampil di UI', async () => {
  cleanBody();
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = ReactDOM.createRoot(container as any);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const urlStr = String(url);
    if (urlStr.includes('/api/account/summary')) {
      return new Response(JSON.stringify({
        user: { id: 'u_p_1', name: 'Parallel User', email: 'parallel@example.com', createdAt: '2026-10-01' },
        usage: { totals: { local_transcription_completed: 7, transcript_export_completed: 3, catetin_backup_completed: 1 }, recentDaily: [], totalCount: 11 },
      }));
    }
    if (urlStr.includes('list-sessions')) {
      return new Response(JSON.stringify([
        { id: 's_par_1', createdAt: '2026-10-28', expiresAt: '2026-11-28', userAgent: 'Chrome on Windows' },
      ]));
    }
    if (urlStr.includes('/api/account/entitlement')) {
      return new Response(JSON.stringify({
        plan: 'pro',
        status: 'active',
        startsAt: '2026-10-01T00:00:00Z',
        endsAt: '2027-10-01T00:00:00Z',
        source: 'promotion',
        serverNow: '2026-10-28T12:00:00Z',
        features: ['local_workspace', 'local_transcription', 'standard_exports', 'local_backup'],
      }));
    }
    return new Response(JSON.stringify({ ok: true }));
  }) as any;

  try {
    const session: UseAccountSessionResult = {
      status: 'authenticated',
      user: { id: 'u_p_1', name: 'Parallel User', email: 'parallel@example.com', image: null },
      sessionId: 's_par_1',
      error: null,
      refresh: async () => {},
      signInWithGoogle: async () => {},
      signOut: async () => ({ success: true as const }),
    };

    root.render(<AccountCenter session={session} onBack={() => {}} />);
    await new Promise((r) => setTimeout(r, 120));

    const html = container.innerHTML;
    // Bukti summary sukses tampil
    assert.ok(html.includes('Transkripsi selesai'), 'Summary usage harus tampil');
    assert.ok(html.includes('7'), 'Hitungan transkripsi 7 harus tampil');

    // Bukti sessions sukses tampil
    assert.ok(html.includes('Perangkat ini'), 'Sesi perangkat ini harus tampil');

    // Bukti entitlement sukses tampil
    assert.ok(html.includes('Catetin Pro'), 'Paket Pro dari entitlement harus tampil');
    assert.ok(html.includes('Aktif'), 'Status Pro aktif harus tampil');
  } finally {
    globalThis.fetch = originalFetch;
    root.unmount();
    cleanBody();
  }
});

test('konkurensi: deferred-response integration test menyelesaikan summary, sessions, dan entitlement dalam urutan acak dan membuktikan ketiganya tampil', async () => {
  cleanBody();
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = ReactDOM.createRoot(container as any);

  let resolveSummary: (val: any) => void;
  let resolveSessions: (val: any) => void;
  let resolveEntitlement: (val: any) => void;

  const summaryPromise = new Promise((res) => { resolveSummary = res; });
  const sessionsPromise = new Promise((res) => { resolveSessions = res; });
  const entitlementPromise = new Promise((res) => { resolveEntitlement = res; });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const urlStr = String(url);
    if (urlStr.includes('/api/account/summary')) return summaryPromise;
    if (urlStr.includes('list-sessions')) return sessionsPromise;
    if (urlStr.includes('/api/account/entitlement')) return entitlementPromise;
    return new Response(JSON.stringify({ ok: true }));
  }) as any;

  try {
    const session: UseAccountSessionResult = {
      status: 'authenticated',
      user: { id: 'u_def_1', name: 'Deferred User', email: 'def@example.com', image: null },
      sessionId: 's_def_1',
      error: null,
      refresh: async () => {},
      signInWithGoogle: async () => {},
      signOut: async () => ({ success: true as const }),
    };

    root.render(<AccountCenter session={session} onBack={() => {}} />);
    await new Promise((r) => setTimeout(r, 60));

    // Urutan penyelesaian berbeda: 1. Entitlement selesai duluan
    resolveEntitlement!(new Response(JSON.stringify({
      plan: 'pro',
      status: 'active',
      startsAt: '2026-10-01T00:00:00Z',
      endsAt: '2027-10-01T00:00:00Z',
      source: 'promotion',
      serverNow: '2026-10-28T12:00:00Z',
      features: ['local_workspace', 'local_transcription', 'standard_exports', 'local_backup'],
    })));
    await new Promise((r) => setTimeout(r, 60));

    // Urutan 2: Sessions selesai berikutnya
    resolveSessions!(new Response(JSON.stringify([
      { id: 's_def_1', createdAt: '2026-10-28', expiresAt: '2026-11-28', userAgent: 'Mac Safari' },
    ])));
    await new Promise((r) => setTimeout(r, 60));

    // Urutan 3: Summary selesai paling akhir
    resolveSummary!(new Response(JSON.stringify({
      user: { id: 'u_def_1', name: 'Deferred User', email: 'def@example.com', createdAt: '2026-10-01' },
      usage: { totals: { local_transcription_completed: 42, transcript_export_completed: 10, catetin_backup_completed: 5 }, recentDaily: [], totalCount: 57 },
    })));
    await new Promise((r) => setTimeout(r, 80));

    const html = container.innerHTML;
    // Ketiganya wajib berhasil tampil di DOM tanpa saling menimpa
    assert.ok(html.includes('Catetin Pro'), 'Entitlement yang selesai pertama harus tetap tampil');
    assert.ok(html.includes('Perangkat ini'), 'Sessions yang selesai kedua harus tampil');
    assert.ok(html.includes('42'), 'Summary yang selesai terakhir harus tampil');
  } finally {
    globalThis.fetch = originalFetch;
    root.unmount();
    cleanBody();
  }
});

test('konkurensi: logout atau user switch membuang ketiga response lama yang masih in-flight', async () => {
  cleanBody();
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = ReactDOM.createRoot(container as any);

  let resolveUserASummary: (val: any) => void;
  let resolveUserASessions: (val: any) => void;
  let resolveUserAEntitlement: (val: any) => void;

  const summaryPromise = new Promise((res) => { resolveUserASummary = res; });
  const sessionsPromise = new Promise((res) => { resolveUserASessions = res; });
  const entitlementPromise = new Promise((res) => { resolveUserAEntitlement = res; });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const urlStr = String(url);
    if (urlStr.includes('/api/account/summary')) return summaryPromise;
    if (urlStr.includes('list-sessions')) return sessionsPromise;
    if (urlStr.includes('/api/account/entitlement')) return entitlementPromise;
    return new Response(JSON.stringify({ ok: true }));
  }) as any;

  try {
    const sessionUserA: UseAccountSessionResult = {
      status: 'authenticated',
      user: { id: 'u_secret_A', name: 'User A Top Secret', email: 'secretA@example.com', image: null },
      sessionId: 's_secret_A',
      error: null,
      refresh: async () => {},
      signInWithGoogle: async () => {},
      signOut: async () => ({ success: true as const }),
    };

    root.render(<AccountCenter session={sessionUserA} onBack={() => {}} />);
    await new Promise((r) => setTimeout(r, 60));

    // User A logout sebelum ketiga request selesai
    const sessionGuest: UseAccountSessionResult = {
      status: 'guest',
      user: null,
      sessionId: null,
      error: null,
      refresh: async () => {},
      signInWithGoogle: async () => {},
      signOut: async () => ({ success: true as const }),
    };
    root.render(<AccountCenter session={sessionGuest} onBack={() => {}} />);
    await new Promise((r) => setTimeout(r, 60));

    // Ketiga response User A kini selesai tiba
    resolveUserAEntitlement!(new Response(JSON.stringify({
      plan: 'pro',
      status: 'active',
      startsAt: '2026-10-01T00:00:00Z',
      endsAt: '2027-10-01T00:00:00Z',
      source: 'promotion',
      serverNow: '2026-10-28T12:00:00Z',
      features: ['local_workspace', 'local_transcription', 'standard_exports', 'local_backup'],
    })));
    resolveUserASessions!(new Response(JSON.stringify([
      { id: 's_secret_A', createdAt: '2026-10-28', expiresAt: '2026-11-28', userAgent: 'Secret Device' },
    ])));
    resolveUserASummary!(new Response(JSON.stringify({
      user: { id: 'u_secret_A', name: 'User A Top Secret', email: 'secretA@example.com', createdAt: '2026-10-01' },
      usage: { totals: { local_transcription_completed: 888 }, recentDaily: [], totalCount: 888 },
    })));
    await new Promise((r) => setTimeout(r, 80));

    const html = container.innerHTML;
    // Tidak boleh ada data User A yang bocor
    assert.equal(html.includes('User A Top Secret'), false, 'Nama rahasia User A dilarang tampil');
    assert.equal(html.includes('888'), false, 'Usage rahasia User A dilarang tampil');
    assert.equal(html.includes('Catetin Pro'), false, 'Status Pro User A dilarang tampil');
  } finally {
    globalThis.fetch = originalFetch;
    root.unmount();
    cleanBody();
  }
});

test('AccountCenterView: status pending merender label Segera aktif dan tanggal mulai aktif', () => {
  const props = createMockViewProps({
    entitlementStatus: 'success',
    entitlement: {
      plan: 'free',
      status: 'pending',
      startsAt: '2026-11-01T00:00:00Z',
      endsAt: '2027-11-01T00:00:00Z',
      source: 'promotion',
      serverNow: '2026-10-28T12:00:00Z',
      features: ['local_workspace', 'local_transcription', 'standard_exports', 'local_backup'],
    },
  });

  const html = renderToString(<AccountCenterView {...props} />);
  assert.ok(html.includes('Catetin Free'), 'Plan efektif saat pending harus Free');
  assert.ok(html.includes('Segera aktif'), 'Badge pending harus berbunyi Segera aktif');
  assert.ok(html.includes('Mulai aktif:'), 'Informasi tanggal mulai aktif harus tertera');
});
