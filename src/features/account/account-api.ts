import { authClient } from './auth-client.ts';
import { FEATURE_KEYS } from './feature-catalog.ts';

export const ALLOWED_EVENT_TYPES = [
  'local_transcription_completed',
  'transcript_export_completed',
  'catetin_backup_completed',
] as const;

export type AllowedEventType = (typeof ALLOWED_EVENT_TYPES)[number];

export function isAllowedEventType(val: unknown): val is AllowedEventType {
  return typeof val === 'string' && (ALLOWED_EVENT_TYPES as readonly string[]).includes(val);
}

export interface AccountSummaryUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  createdAt: string;
}

export interface AccountUsageRecentEntry {
  usageDate: string;
  eventType: AllowedEventType;
  count: number;
}

export interface AccountUsageTotals {
  local_transcription_completed: number;
  transcript_export_completed: number;
  catetin_backup_completed: number;
}

export interface AccountSummary {
  user: AccountSummaryUser;
  usage: {
    totals: AccountUsageTotals;
    recentDaily: AccountUsageRecentEntry[];
    totalCount: number;
  };
}

export interface AccountSessionItem {
  id: string;
  createdAt: string;
  expiresAt: string;
  userAgent?: string | null;
  token?: string;
  isCurrent?: boolean;
}

export type AccountSummaryResult =
  | { status: 'success'; data: AccountSummary }
  | { status: 'unauthorized' }
  | { status: 'error'; message: string };

export type AccountSessionsResult =
  | { status: 'success'; data: AccountSessionItem[] }
  | { status: 'unauthorized' }
  | { status: 'error'; message: string };

export type PlanTier = 'free' | 'pro';
export type EntitlementStatus = 'active' | 'grace' | 'expired' | 'revoked' | 'none' | 'pending';
export type EntitlementSource = 'promotion' | 'admin' | 'midtrans';

export interface AccountEntitlement {
  plan: PlanTier;
  status: EntitlementStatus;
  startsAt: string | null;
  endsAt: string | null;
  source: EntitlementSource | null;
  serverNow: string;
  features: string[];
}

export type AccountEntitlementResult =
  | { status: 'success'; data: AccountEntitlement }
  | { status: 'unauthorized' }
  | { status: 'error'; message: string };

/**
 * Runtime validator for server entitlement payload.
 * Rejects malformed enum, invalid date, foreign features, or incomplete payloads.
 */
export function parseAccountEntitlement(
  raw: unknown
): { ok: true; value: AccountEntitlement } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Respons entitlement bukan objek JSON yang valid' };
  }

  const obj = raw as Record<string, unknown>;

  // plan: 'free' | 'pro'
  if (obj.plan !== 'free' && obj.plan !== 'pro') {
    return { ok: false, error: 'Nilai plan tidak valid' };
  }

  // status: 'active' | 'grace' | 'expired' | 'revoked' | 'none' | 'pending'
  const validStatuses: EntitlementStatus[] = ['active', 'grace', 'expired', 'revoked', 'none', 'pending'];
  if (typeof obj.status !== 'string' || !validStatuses.includes(obj.status as EntitlementStatus)) {
    return { ok: false, error: 'Nilai status entitlement tidak valid' };
  }

  // source: 'promotion' | 'admin' | 'midtrans' | null
  const validSources: EntitlementSource[] = ['promotion', 'admin', 'midtrans'];
  if (
    obj.source !== null &&
    (typeof obj.source !== 'string' || !validSources.includes(obj.source as EntitlementSource))
  ) {
    return { ok: false, error: 'Nilai source entitlement tidak valid' };
  }

  // startsAt: ISO string or null
  if (obj.startsAt !== null) {
    if (typeof obj.startsAt !== 'string' || Number.isNaN(new Date(obj.startsAt).getTime())) {
      return { ok: false, error: 'Nilai startsAt bukan tanggal ISO yang valid' };
    }
  }

  // endsAt: ISO string or null
  if (obj.endsAt !== null) {
    if (typeof obj.endsAt !== 'string' || Number.isNaN(new Date(obj.endsAt).getTime())) {
      return { ok: false, error: 'Nilai endsAt bukan tanggal ISO yang valid' };
    }
  }

  // serverNow: ISO string (mandatory)
  if (typeof obj.serverNow !== 'string' || Number.isNaN(new Date(obj.serverNow).getTime())) {
    return { ok: false, error: 'Nilai serverNow bukan tanggal ISO yang valid' };
  }

  // features: array of strings from allowlist FEATURE_KEYS
  if (!Array.isArray(obj.features)) {
    return { ok: false, error: 'Daftar fitur entitlement bukan array' };
  }
  for (const feat of obj.features) {
    if (typeof feat !== 'string' || !(FEATURE_KEYS as readonly string[]).includes(feat as any)) {
      return { ok: false, error: `Fitur entitlement tidak dikenal: ${feat}` };
    }
  }

  return {
    ok: true,
    value: {
      plan: obj.plan,
      status: obj.status as EntitlementStatus,
      startsAt: obj.startsAt as string | null,
      endsAt: obj.endsAt as string | null,
      source: obj.source as EntitlementSource | null,
      serverNow: obj.serverNow as string,
      features: obj.features as string[],
    },
  };
}

export function humanizeUserAgent(userAgent?: string | null): { browser: string; os: string; label: string } {
  if (!userAgent || typeof userAgent !== 'string' || !userAgent.trim()) {
    return { browser: 'Peramban', os: 'Sistem', label: 'Sesi peramban' };
  }

  const ua = userAgent;

  // Detect OS
  let os = 'Sistem';
  if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Linux/i.test(ua)) os = 'Linux';

  // Detect Browser
  let browser = 'Peramban';
  if (/Edg\//i.test(ua)) browser = 'Microsoft Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Chrome\//i.test(ua)) browser = 'Google Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Mozilla Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Apple Safari';

  return {
    browser,
    os,
    label: `${browser} di ${os}`,
  };
}

/**
 * Record a privacy-safe daily aggregate usage counter.
 * Fire-and-forget: Never throws or halts local-first audio transcription / export.
 * CRITICAL RULE: Guests or unavailable auth MUST NEVER send a usage request (zero fetch).
 */
export async function recordUsageEvent(
  eventType: AllowedEventType,
  isUserAuthenticated = false
): Promise<boolean> {
  // Guard: Guest must send zero usage requests
  if (!isUserAuthenticated || !isAllowedEventType(eventType)) {
    return false;
  }

  try {
    const res = await fetch('/api/account/usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ eventType }),
    });
    return res.ok;
  } catch {
    // Local-first rule: cloud usage recording failure must never break local app operation
    return false;
  }
}

/**
 * Fetch account profile and usage summary from cloud.
 * Differentiates loading, success, unauthorized, and error states.
 */
export async function fetchAccountSummary(): Promise<AccountSummaryResult> {
  try {
    const res = await fetch('/api/account/summary', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (res.status === 401 || res.status === 403) {
      return { status: 'unauthorized' };
    }

    if (!res.ok) {
      return { status: 'error', message: `Server error (${res.status})` };
    }

    const data: AccountSummary = await res.json();
    return { status: 'success', data };
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Network error',
    };
  }
}

/**
 * Fetch account entitlement (Free vs Pro) from server.
 * Source of truth is the cloud server timestamp and D1 database.
 * Local features are never gated by cloud state.
 */
export async function fetchAccountEntitlement(): Promise<AccountEntitlementResult> {
  try {
    const res = await fetch('/api/account/entitlement', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (res.status === 401 || res.status === 403) {
      return { status: 'unauthorized' };
    }

    if (!res.ok) {
      return { status: 'error', message: `Server error (${res.status})` };
    }

    const json = await res.json();
    const parsed = parseAccountEntitlement(json);
    if (!parsed.ok) {
      return { status: 'error', message: parsed.error };
    }
    return { status: 'success', data: parsed.value };
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Network error',
    };
  }
}

/**
 * List all active sessions for the current user using Better Auth client.
 * Differentiates success, unauthorized, and error states.
 */
export async function listUserSessions(): Promise<AccountSessionsResult> {
  try {
    const res = await (authClient as any).listSessions();
    if (res?.error) {
      if (res.error.status === 401 || res.error.status === 403) {
        return { status: 'unauthorized' };
      }
      return { status: 'error', message: res.error.message || 'Failed to list sessions' };
    }
    if (res?.data && Array.isArray(res.data)) {
      return { status: 'success', data: res.data };
    }
    return { status: 'success', data: [] };
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Failed to list sessions',
    };
  }
}

/**
 * Revoke all other sessions except current.
 */
export async function revokeOtherUserSessions(): Promise<boolean> {
  try {
    const res = await (authClient as any).revokeOtherSessions();
    if (res?.error) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Revoke a single session by its token.
 */
export async function revokeSingleSession(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await (authClient as any).revokeSession({ token });
    if (res?.error) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete cloud account, all cloud sessions, and cloud usage counters.
 * Requires explicit confirmation payload { "confirmation": "delete-account" }.
 * Does NOT touch local IndexedDB workspace or local files.
 */
export async function deleteCloudAccount(): Promise<boolean> {
  try {
    const res = await fetch('/api/account', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmation: 'delete-account' }),
    });

    if (!res.ok) return false;

    // Trigger client signOut to clear state cleanly
    try {
      await authClient.signOut();
    } catch {
      // Ignore client signOut error if server already deleted session
    }
    return true;
  } catch {
    return false;
  }
}
