import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveEffectiveEntitlement,
  FREE_FEATURE_KEYS,
  PRO_FEATURE_KEYS,
  type RawEntitlementRow,
} from '../../worker/entitlement.ts';

test('1. Resolver: user tanpa baris entitlement selalu dihitung sebagai Free', () => {
  const serverNow = new Date('2026-10-28T12:00:00Z');
  const result = resolveEffectiveEntitlement(null, serverNow);

  assert.equal(result.plan, 'free');
  assert.equal(result.status, 'none');
  assert.equal(result.startsAt, null);
  assert.equal(result.endsAt, null);
  assert.equal(result.source, null);
  assert.equal(result.serverNow, serverNow.toISOString());
  assert.deepEqual(result.features, [...FREE_FEATURE_KEYS]);
});

test('2. Resolver: baris active Pro tanpa expiry menghasilkan plan Pro aktif', () => {
  const serverNow = new Date('2026-10-28T12:00:00Z');
  const row: RawEntitlementRow = {
    userId: 'u_1',
    plan: 'pro',
    status: 'active',
    source: 'promotion',
    startsAt: '2026-10-01T00:00:00Z',
    endsAt: null,
  };

  const result = resolveEffectiveEntitlement(row, serverNow);
  assert.equal(result.plan, 'pro');
  assert.equal(result.status, 'active');
  assert.equal(result.startsAt, '2026-10-01T00:00:00Z');
  assert.equal(result.endsAt, null);
  assert.equal(result.source, 'promotion');
  assert.deepEqual(result.features, [...PRO_FEATURE_KEYS]);
});

test('3. Resolver: baris active Pro sebelum endsAt menghasilkan plan Pro aktif', () => {
  const serverNow = new Date('2026-10-28T12:00:00Z');
  const futureEndsAt = '2026-11-28T12:00:00Z';
  const row: RawEntitlementRow = {
    userId: 'u_2',
    plan: 'pro',
    status: 'active',
    source: 'promotion',
    startsAt: '2026-10-01T00:00:00Z',
    endsAt: futureEndsAt,
  };

  const result = resolveEffectiveEntitlement(row, serverNow);
  assert.equal(result.plan, 'pro');
  assert.equal(result.status, 'active');
  assert.equal(result.endsAt, futureEndsAt);
  assert.deepEqual(result.features, [...PRO_FEATURE_KEYS]);
});

test('4. Resolver: baris active Pro tetapi endsAt sudah lewat menghasilkan plan Free dengan status expired', () => {
  const serverNow = new Date('2026-10-28T12:00:00Z');
  const pastEndsAt = '2026-10-27T12:00:00Z'; // Yesterday
  const row: RawEntitlementRow = {
    userId: 'u_3',
    plan: 'pro',
    status: 'active',
    source: 'promotion',
    startsAt: '2026-09-01T00:00:00Z',
    endsAt: pastEndsAt,
  };

  const result = resolveEffectiveEntitlement(row, serverNow);
  assert.equal(result.plan, 'free');
  assert.equal(result.status, 'expired');
  assert.equal(result.endsAt, pastEndsAt);
  assert.deepEqual(result.features, [...FREE_FEATURE_KEYS]);
});

test('5. Resolver: grace behavior konsisten (aktif selama window masa tenggang, expired setelah window lewat)', () => {
  const serverNow = new Date('2026-10-28T12:00:00Z');

  // Case A: Grace with future endsAt -> Pro access with grace status
  const futureGraceRow: RawEntitlementRow = {
    userId: 'u_grace_1',
    plan: 'pro',
    status: 'grace',
    source: 'promotion',
    startsAt: '2026-10-01T00:00:00Z',
    endsAt: '2026-11-05T00:00:00Z',
  };
  const activeGrace = resolveEffectiveEntitlement(futureGraceRow, serverNow);
  assert.equal(activeGrace.plan, 'pro');
  assert.equal(activeGrace.status, 'grace');
  assert.deepEqual(activeGrace.features, [...PRO_FEATURE_KEYS]);

  // Case B: Grace with past endsAt -> Expired, Free access
  const pastGraceRow: RawEntitlementRow = {
    userId: 'u_grace_2',
    plan: 'pro',
    status: 'grace',
    source: 'promotion',
    startsAt: '2026-09-01T00:00:00Z',
    endsAt: '2026-10-20T00:00:00Z',
  };
  const expiredGrace = resolveEffectiveEntitlement(pastGraceRow, serverNow);
  assert.equal(expiredGrace.plan, 'free');
  assert.equal(expiredGrace.status, 'expired');
  assert.deepEqual(expiredGrace.features, [...FREE_FEATURE_KEYS]);

  // Case C: Grace with null endsAt -> Tidak boleh Pro, fallback Free expired
  const nullEndsGraceRow: RawEntitlementRow = {
    userId: 'u_grace_3',
    plan: 'pro',
    status: 'grace',
    source: 'promotion',
    startsAt: '2026-09-01T00:00:00Z',
    endsAt: null,
  };
  const nullGrace = resolveEffectiveEntitlement(nullEndsGraceRow, serverNow);
  assert.equal(nullGrace.plan, 'free');
  assert.equal(nullGrace.status, 'expired');
  assert.deepEqual(nullGrace.features, [...FREE_FEATURE_KEYS]);
});

test('6. Resolver: future startsAt menghasilkan status pending dengan plan Free', () => {
  const serverNow = new Date('2026-10-28T12:00:00Z');
  const futureRow: RawEntitlementRow = {
    userId: 'u_future',
    plan: 'pro',
    status: 'active',
    source: 'promotion',
    startsAt: '2026-11-01T00:00:00Z', // 4 days in the future
    endsAt: '2027-11-01T00:00:00Z',
  };

  const result = resolveEffectiveEntitlement(futureRow, serverNow);
  assert.equal(result.plan, 'free');
  assert.equal(result.status, 'pending');
  assert.equal(result.startsAt, '2026-11-01T00:00:00Z');
  assert.equal(result.endsAt, '2027-11-01T00:00:00Z');
  assert.equal(result.source, 'promotion');
  assert.deepEqual(result.features, [...FREE_FEATURE_KEYS]);
});

test('7. Resolver: invalid startsAt gagal aman ke plan Free', () => {
  const serverNow = new Date('2026-10-28T12:00:00Z');
  const invalidStartsRow: RawEntitlementRow = {
    userId: 'u_bad_start',
    plan: 'pro',
    status: 'active',
    source: 'promotion',
    startsAt: 'not-a-valid-date',
    endsAt: '2027-01-01T00:00:00Z',
  };

  const result = resolveEffectiveEntitlement(invalidStartsRow, serverNow);
  assert.equal(result.plan, 'free');
  assert.equal(result.status, 'none');
  assert.deepEqual(result.features, [...FREE_FEATURE_KEYS]);
});

test('8. Resolver: endsAt <= startsAt gagal aman ke plan Free', () => {
  const serverNow = new Date('2026-10-28T12:00:00Z');

  // endsAt identical to startsAt
  const equalRow: RawEntitlementRow = {
    userId: 'u_equal',
    plan: 'pro',
    status: 'active',
    source: 'promotion',
    startsAt: '2026-10-01T00:00:00Z',
    endsAt: '2026-10-01T00:00:00Z',
  };
  const equalResult = resolveEffectiveEntitlement(equalRow, serverNow);
  assert.equal(equalResult.plan, 'free');
  assert.equal(equalResult.status, 'none');

  // endsAt earlier than startsAt
  const earlierRow: RawEntitlementRow = {
    userId: 'u_earlier',
    plan: 'pro',
    status: 'active',
    source: 'promotion',
    startsAt: '2026-10-01T00:00:00Z',
    endsAt: '2026-09-01T00:00:00Z',
  };
  const earlierResult = resolveEffectiveEntitlement(earlierRow, serverNow);
  assert.equal(earlierResult.plan, 'free');
  assert.equal(earlierResult.status, 'none');
});

test('9. Resolver: invalid source gagal aman ke plan Free', () => {
  const serverNow = new Date('2026-10-28T12:00:00Z');
  const badSourceRow: RawEntitlementRow = {
    userId: 'u_bad_source',
    plan: 'pro',
    status: 'active',
    source: 'paypal' as any, // Not an allowed source
    startsAt: '2026-10-01T00:00:00Z',
    endsAt: '2027-10-01T00:00:00Z',
  };

  const result = resolveEffectiveEntitlement(badSourceRow, serverNow);
  assert.equal(result.plan, 'free');
  assert.equal(result.status, 'none');
  assert.deepEqual(result.features, [...FREE_FEATURE_KEYS]);
});

test('10. Resolver: revoked status selalu menghasilkan plan Free', () => {
  const serverNow = new Date('2026-10-28T12:00:00Z');
  const row: RawEntitlementRow = {
    userId: 'u_4',
    plan: 'pro',
    status: 'revoked',
    source: 'admin',
    startsAt: '2026-10-01T00:00:00Z',
    endsAt: '2027-10-01T00:00:00Z', // Even if endsAt is in future
  };

  const result = resolveEffectiveEntitlement(row, serverNow);
  assert.equal(result.plan, 'free');
  assert.equal(result.status, 'revoked');
  assert.deepEqual(result.features, [...FREE_FEATURE_KEYS]);
});

test('11. Resolver: baris malformed gagal aman ke plan Free', () => {
  const serverNow = new Date('2026-10-28T12:00:00Z');

  // Unknown plan
  assert.equal(
    resolveEffectiveEntitlement(
      { plan: 'enterprise', status: 'active', source: 'admin', startsAt: '2026-01-01' } as any,
      serverNow
    ).plan,
    'free'
  );
  // Unknown raw status
  assert.equal(
    resolveEffectiveEntitlement(
      { plan: 'pro', status: 'unknown_status', source: 'admin', startsAt: '2026-01-01' } as any,
      serverNow
    ).plan,
    'free'
  );
  // Non-object
  assert.equal(resolveEffectiveEntitlement('invalid' as any, serverNow).plan, 'free');
  assert.equal(resolveEffectiveEntitlement(12345 as any, serverNow).plan, 'free');
});

test('12. Resolver: invalid now menghasilkan fail-safe Free', () => {
  const invalidNow = new Date('invalid-date');
  const result = resolveEffectiveEntitlement(null, invalidNow);
  assert.equal(result.plan, 'free');
  assert.equal(result.status, 'none');
});
