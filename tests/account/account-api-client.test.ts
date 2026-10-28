import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  humanizeUserAgent,
  isAllowedEventType,
  recordUsageEvent,
  parseAccountEntitlement,
  fetchAccountEntitlement,
} from '../../src/features/account/account-api.ts';

test('humanizeUserAgent memformat nama browser dan sistem operasi secara manusiawi tanpa raw user-agent panjang atau IP', () => {
  // Windows + Chrome
  const winChrome = humanizeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  assert.equal(winChrome.browser, 'Google Chrome');
  assert.equal(winChrome.os, 'Windows');
  assert.equal(winChrome.label, 'Google Chrome di Windows');

  // Mac + Safari
  const macSafari = humanizeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15');
  assert.equal(macSafari.browser, 'Apple Safari');
  assert.equal(macSafari.os, 'macOS');
  assert.equal(macSafari.label, 'Apple Safari di macOS');

  // iPhone + Safari
  const iPhoneSafari = humanizeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1');
  assert.equal(iPhoneSafari.browser, 'Apple Safari');
  assert.equal(iPhoneSafari.os, 'iOS');
  assert.equal(iPhoneSafari.label, 'Apple Safari di iOS');

  // Android + Chrome
  const androidChrome = humanizeUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36');
  assert.equal(androidChrome.browser, 'Google Chrome');
  assert.equal(androidChrome.os, 'Android');
  assert.equal(androidChrome.label, 'Google Chrome di Android');

  // Linux + Firefox
  const linuxFirefox = humanizeUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0');
  assert.equal(linuxFirefox.browser, 'Mozilla Firefox');
  assert.equal(linuxFirefox.os, 'Linux');
  assert.equal(linuxFirefox.label, 'Mozilla Firefox di Linux');

  // Edge di Windows
  const winEdge = humanizeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0');
  assert.equal(winEdge.browser, 'Microsoft Edge');
  assert.equal(winEdge.os, 'Windows');
  assert.equal(winEdge.label, 'Microsoft Edge di Windows');

  // String kosong atau null
  const empty = humanizeUserAgent('');
  assert.equal(empty.label, 'Sesi peramban');

  const nullVal = humanizeUserAgent(null);
  assert.equal(nullVal.label, 'Sesi peramban');

  // Jangan pernah memuat IP address
  assert.equal(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(winChrome.label), false);
});

test('isAllowedEventType memvalidasi hanya tiga event yang diizinkan', () => {
  assert.equal(isAllowedEventType('local_transcription_completed'), true);
  assert.equal(isAllowedEventType('transcript_export_completed'), true);
  assert.equal(isAllowedEventType('catetin_backup_completed'), true);

  assert.equal(isAllowedEventType('audio_uploaded'), false);
  assert.equal(isAllowedEventType('project_created'), false);
  assert.equal(isAllowedEventType('arbitrary_event'), false);
  assert.equal(isAllowedEventType(null), false);
  assert.equal(isAllowedEventType(undefined), false);
});

test('Guest must send zero usage requests: saat isUserAuthenticated false, aksi menghasilkan 0 fetch call', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;

  globalThis.fetch = (async () => {
    fetchCallCount++;
    return new Response(JSON.stringify({ ok: true }));
  }) as any;

  try {
    // 1. Guest mencoba record usage -> harus langsung return false tanpa panggil fetch
    const guestResult1 = await recordUsageEvent('local_transcription_completed', false);
    assert.equal(guestResult1, false);
    assert.equal(fetchCallCount, 0, 'Guest dilarang memicu fetch ke server (harus 0 fetch)');

    const guestResult2 = await recordUsageEvent('transcript_export_completed', false);
    assert.equal(guestResult2, false);
    assert.equal(fetchCallCount, 0, 'Guest dilarang memicu fetch ke server (harus 0 fetch)');

    // 2. Authenticated user memanggil fetch
    const authResult = await recordUsageEvent('local_transcription_completed', true);
    assert.equal(authResult, true);
    assert.equal(fetchCallCount, 1, 'Authenticated user memanggil fetch tepat 1 kali');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Stale auth closure prevention: controller dibuat saat loading lalu status menjadi authenticated mencatat tepat 1 usage', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;
  const recordedBodies: any[] = [];

  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    fetchCallCount++;
    if (init?.body) {
      recordedBodies.push(JSON.parse(String(init.body)));
    }
    return new Response(JSON.stringify({ ok: true, eventType: 'local_transcription_completed' }));
  }) as any;

  try {
    // 1. Simulasikan lifecycle komponen: ref session dibuat dengan initial status 'loading'
    const sessionRef: { current: { status: 'loading' | 'authenticated' | 'guest'; user: any } } = {
      current: {
        status: 'loading',
        user: null,
      },
    };

    // Callback onComplete dibuat sekali dan menangkap sessionRef (bukan session value langsung)
    const onTranscriptionComplete = async () => {
      await recordUsageEvent('local_transcription_completed', sessionRef.current.status === 'authenticated');
    };

    // 2. Sesi selesai di-fetch dan berubah menjadi 'authenticated'
    sessionRef.current = {
      status: 'authenticated',
      user: { id: 'user_live_123', name: 'Bob', email: 'bob@example.com' } as any,
    };

    // 3. Transkripsi selesai
    await onTranscriptionComplete();

    // Verifikasi: tepat satu fetch dikirim dengan eventType yang benar
    assert.equal(fetchCallCount, 1, 'Tepat satu fetch usage dikirim saat user terotentikasi');
    assert.equal(recordedBodies.length, 1);
    assert.equal(recordedBodies[0].eventType, 'local_transcription_completed');

    // 4. Jika user adalah guest (status guest), onTranscriptionComplete menghasilkan 0 fetch tambahan
    sessionRef.current = {
      status: 'guest',
      user: null,
    };

    await onTranscriptionComplete();
    assert.equal(fetchCallCount, 1, 'Guest completion dilarang memicu fetch tambahan (tetap 1)');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('parseAccountEntitlement: memvalidasi enum, tanggal, dan feature keys allowlisted', () => {
  const validPayload = {
    plan: 'pro',
    status: 'active',
    startsAt: '2026-10-01T00:00:00Z',
    endsAt: '2027-10-01T00:00:00Z',
    source: 'promotion',
    serverNow: '2026-10-28T12:00:00Z',
    features: ['local_workspace', 'local_transcription', 'standard_exports', 'local_backup'],
  };

  const parsedValid = parseAccountEntitlement(validPayload);
  assert.equal(parsedValid.ok, true);
  if (parsedValid.ok) {
    assert.equal(parsedValid.value.plan, 'pro');
    assert.equal(parsedValid.value.status, 'active');
  }

  // 1. Malformed enum plan
  assert.equal(parseAccountEntitlement({ ...validPayload, plan: 'ultra' }).ok, false);

  // 2. Malformed status
  assert.equal(parseAccountEntitlement({ ...validPayload, status: 'canceled' }).ok, false);

  // 3. Status pending valid
  const pendingPayload = { ...validPayload, plan: 'free', status: 'pending' };
  assert.equal(parseAccountEntitlement(pendingPayload).ok, true);

  // 4. Malformed source
  assert.equal(parseAccountEntitlement({ ...validPayload, source: 'stripe' }).ok, false);

  // 5. Invalid dates
  assert.equal(parseAccountEntitlement({ ...validPayload, startsAt: 'invalid-date' }).ok, false);
  assert.equal(parseAccountEntitlement({ ...validPayload, endsAt: 'invalid-date' }).ok, false);
  assert.equal(parseAccountEntitlement({ ...validPayload, serverNow: 'invalid-date' }).ok, false);

  // 6. Foreign / untrusted feature keys
  assert.equal(parseAccountEntitlement({ ...validPayload, features: ['untrusted_feature_inject'] }).ok, false);

  // 7. Incomplete payload
  assert.equal(parseAccountEntitlement(null).ok, false);
  assert.equal(parseAccountEntitlement([]).ok, false);
  assert.equal(parseAccountEntitlement({ plan: 'free' }).ok, false);
});

test('fetchAccountEntitlement: response 200 malformed ditolak sebagai error dan TIDAK dianggap Free', async () => {
  const originalFetch = globalThis.fetch;

  try {
    // Simulasi respons 200 dengan JSON yang rusak/malformed
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({
        plan: 'invalid_tier',
        status: 'active',
        features: ['not_a_valid_feature'],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const res = await fetchAccountEntitlement();

    // Harus error, BUKAN success dan BUKAN Free palsu
    assert.equal(res.status, 'error');
    if (res.status === 'error') {
      assert.ok(res.message.length > 0);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
