// Server-side entitlement resolver for Cloudflare Worker & D1
// Catetin Stage 4C1: Free/Pro Entitlement Resolver
// Note: Catetin follows the local-first zero-cloud rule.
// Workspace contents are never stored in or checked against the cloud.

export type PlanTier = 'free' | 'pro';
export type EntitlementStatus = 'active' | 'grace' | 'expired' | 'revoked' | 'none' | 'pending';
export type EntitlementSource = 'promotion' | 'admin' | 'midtrans';

export interface EntitlementResolution {
  plan: PlanTier;
  status: EntitlementStatus;
  startsAt: string | null;
  endsAt: string | null;
  source: EntitlementSource | null;
  serverNow: string;
  features: string[];
}

export interface RawEntitlementRow {
  userId?: string;
  plan?: string;
  status?: string;
  source?: string;
  startsAt?: string;
  endsAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export const FREE_FEATURE_KEYS = [
  'local_workspace',
  'local_transcription',
  'standard_exports',
  'local_backup',
] as const;

export const PRO_FEATURE_KEYS = [
  'local_workspace',
  'local_transcription',
  'standard_exports',
  'local_backup',
] as const;

const ALLOWED_SOURCES: readonly EntitlementSource[] = ['promotion', 'admin', 'midtrans'];
const ALLOWED_RAW_STATUSES = ['active', 'grace', 'expired', 'revoked'] as const;

function createFailSafeFree(serverNow: string): EntitlementResolution {
  return {
    plan: 'free',
    status: 'none',
    startsAt: null,
    endsAt: null,
    source: null,
    serverNow,
    features: [...FREE_FEATURE_KEYS],
  };
}

/**
 * Resolves the effective plan and entitlement status for a user.
 * Server timestamp is the sole source of truth.
 */
export function resolveEffectiveEntitlement(
  row: RawEntitlementRow | null | undefined,
  now: Date = new Date()
): EntitlementResolution {
  const nowMs = now.getTime();
  if (Number.isNaN(nowMs)) {
    return createFailSafeFree(new Date(0).toISOString());
  }

  const serverNow = now.toISOString();

  // If no entitlement row exists, user is Free
  if (!row) {
    return createFailSafeFree(serverNow);
  }

  // Fail-safe validation for malformed rows
  if (
    typeof row !== 'object' ||
    row.plan !== 'pro' ||
    typeof row.status !== 'string' ||
    typeof row.startsAt !== 'string'
  ) {
    return createFailSafeFree(serverNow);
  }

  // Validate startsAt timestamp
  const startsMs = new Date(row.startsAt).getTime();
  if (Number.isNaN(startsMs)) {
    return createFailSafeFree(serverNow);
  }

  // Validate source: source is strictly required and must be promotion, admin, or midtrans
  if (
    typeof row.source !== 'string' ||
    !ALLOWED_SOURCES.includes(row.source as EntitlementSource)
  ) {
    return createFailSafeFree(serverNow);
  }
  const source = row.source as EntitlementSource;

  // Validate raw status
  if (!ALLOWED_RAW_STATUSES.includes(row.status as any)) {
    return createFailSafeFree(serverNow);
  }
  const rawStatus = row.status as (typeof ALLOWED_RAW_STATUSES)[number];

  // Validate endsAt, if present
  let endsAt: string | null = null;
  let endsMs: number | null = null;
  if (row.endsAt !== null && row.endsAt !== undefined) {
    if (typeof row.endsAt !== 'string' || !row.endsAt.trim()) {
      return createFailSafeFree(serverNow);
    }
    endsMs = new Date(row.endsAt).getTime();
    if (Number.isNaN(endsMs)) {
      return createFailSafeFree(serverNow);
    }
    // endsAt cannot be less than or equal to startsAt
    if (endsMs <= startsMs) {
      return createFailSafeFree(serverNow);
    }
    endsAt = row.endsAt;
  }

  // Rule 1: startsAt in the future cannot grant Pro access.
  // Effective status is pending with Free plan.
  if (startsMs > nowMs) {
    return {
      plan: 'free',
      status: 'pending',
      startsAt: row.startsAt,
      endsAt,
      source,
      serverNow,
      features: [...FREE_FEATURE_KEYS],
    };
  }

  // Rule 2: Explicitly revoked entitlement always produces Free plan
  if (rawStatus === 'revoked') {
    return {
      plan: 'free',
      status: 'revoked',
      startsAt: row.startsAt,
      endsAt,
      source,
      serverNow,
      features: [...FREE_FEATURE_KEYS],
    };
  }

  // Rule 3: Explicitly expired entitlement produces Free plan
  if (rawStatus === 'expired') {
    return {
      plan: 'free',
      status: 'expired',
      startsAt: row.startsAt,
      endsAt,
      source,
      serverNow,
      features: [...FREE_FEATURE_KEYS],
    };
  }

  // Rule 4: Grace status
  // Grace MUST have a valid endsAt in the future.
  // If endsAt is null, past, or invalid, user cannot have Pro.
  if (rawStatus === 'grace') {
    if (endsAt === null || endsMs === null || endsMs <= nowMs) {
      return {
        plan: 'free',
        status: 'expired',
        startsAt: row.startsAt,
        endsAt,
        source,
        serverNow,
        features: [...FREE_FEATURE_KEYS],
      };
    }
    return {
      plan: 'pro',
      status: 'grace',
      startsAt: row.startsAt,
      endsAt,
      source,
      serverNow,
      features: [...PRO_FEATURE_KEYS],
    };
  }

  // Rule 5: Active Pro status
  // - active with endsAt null is Pro without end date.
  // - active with future endsAt is Pro.
  // - active with past endsAt is Free with expired status.
  if (rawStatus === 'active') {
    if (endsAt === null || endsMs === null) {
      return {
        plan: 'pro',
        status: 'active',
        startsAt: row.startsAt,
        endsAt: null,
        source,
        serverNow,
        features: [...PRO_FEATURE_KEYS],
      };
    }
    if (endsMs > nowMs) {
      return {
        plan: 'pro',
        status: 'active',
        startsAt: row.startsAt,
        endsAt,
        source,
        serverNow,
        features: [...PRO_FEATURE_KEYS],
      };
    }
    return {
      plan: 'free',
      status: 'expired',
      startsAt: row.startsAt,
      endsAt,
      source,
      serverNow,
      features: [...FREE_FEATURE_KEYS],
    };
  }

  // Default fail-safe
  return createFailSafeFree(serverNow);
}
