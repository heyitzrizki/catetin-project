import type { Env } from './env.ts';
import { createAuth } from './auth.ts';
import { jsonResponse, normalizeOrigin, isOriginAllowed } from './http.ts';
import { resolveEffectiveEntitlement, type RawEntitlementRow } from './entitlement.ts';

export const ALLOWED_EVENT_TYPES = [
  'local_transcription_completed',
  'transcript_export_completed',
  'catetin_backup_completed',
] as const;

export type AllowedEventType = (typeof ALLOWED_EVENT_TYPES)[number];

export function isAllowedEventType(val: unknown): val is AllowedEventType {
  return typeof val === 'string' && (ALLOWED_EVENT_TYPES as readonly string[]).includes(val);
}

const MAX_PAYLOAD_BYTES = 1024; // 1 KB strict conservative limit

async function parseStrictJsonObject(
  request: Request
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader && parseInt(contentLengthHeader, 10) > MAX_PAYLOAD_BYTES) {
    return { ok: false, status: 400, error: 'payload_too_large' };
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return { ok: false, status: 400, error: 'invalid_content_type' };
  }

  let rawText = '';
  try {
    rawText = await request.text();
  } catch {
    return { ok: false, status: 400, error: 'read_error' };
  }

  const utf8Bytes = new TextEncoder().encode(rawText).byteLength;
  if (utf8Bytes > MAX_PAYLOAD_BYTES) {
    return { ok: false, status: 400, error: 'payload_too_large' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, status: 400, error: 'invalid_json' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, status: 400, error: 'invalid_payload' };
  }

  return { ok: true, body: parsed as Record<string, unknown> };
}

function accountJsonResponse(data: unknown, status = 200, headers?: HeadersInit): Response {
  return jsonResponse(data, status, {
    'Cache-Control': 'no-store',
    'Vary': 'Cookie, Origin',
    ...headers,
  });
}

export async function handleAccountRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const canonical = normalizeOrigin(env.APP_ORIGIN!);

  // 1. CSRF & Origin validation for mutating requests (POST, DELETE)
  if (request.method === 'POST' || request.method === 'DELETE') {
    const origin = request.headers.get('Origin');
    if (!origin || !isOriginAllowed(origin, canonical)) {
      return accountJsonResponse({ error: 'untrusted_origin' }, 403);
    }
  }

  // 2. Authentication check
  let auth;
  let sessionResult;
  try {
    auth = createAuth(env);
    sessionResult = await auth.api.getSession({
      headers: request.headers,
    });
  } catch {
    return accountJsonResponse({ error: 'auth_error' }, 500);
  }

  if (!sessionResult || !sessionResult.user || !sessionResult.user.id) {
    return accountJsonResponse({ error: 'unauthorized' }, 401);
  }

  const userId = sessionResult.user.id;

  try {
    // 3. GET /api/account/summary
    if (pathname === '/api/account/summary') {
      if (request.method !== 'GET') {
        return accountJsonResponse({ error: 'method_not_allowed' }, 405);
      }

      // Query aggregate totals per event type
      const totalsResult = await env.DB.prepare(
        'SELECT "eventType", SUM("count") as total FROM "account_usage" WHERE "userId" = ? GROUP BY "eventType"'
      ).bind(userId).all();

      const totals: Record<AllowedEventType, number> = {
        local_transcription_completed: 0,
        transcript_export_completed: 0,
        catetin_backup_completed: 0,
      };

      let totalCount = 0;
      if (Array.isArray(totalsResult.results)) {
        for (const row of totalsResult.results as any[]) {
          if (row && typeof row === 'object') {
            const evType = (row as any).eventType;
            const total = Number((row as any).total);
            if (isAllowedEventType(evType) && !Number.isNaN(total)) {
              totals[evType] = total;
              totalCount += total;
            }
          }
        }
      }

      // Query recent daily activity (last 30 entries)
      const recentResult = await env.DB.prepare(
        'SELECT "usageDate", "eventType", "count" FROM "account_usage" WHERE "userId" = ? ORDER BY "usageDate" DESC, "createdAt" DESC LIMIT 30'
      ).bind(userId).all();

      const recentDaily = Array.isArray(recentResult.results) ? recentResult.results : [];

      return accountJsonResponse({
        user: {
          id: sessionResult.user.id,
          name: sessionResult.user.name,
          email: sessionResult.user.email,
          image: sessionResult.user.image ?? null,
          createdAt: sessionResult.user.createdAt,
        },
        usage: {
          totals,
          recentDaily,
          totalCount,
        },
      });
    }

    // 4. POST /api/account/usage
    if (pathname === '/api/account/usage') {
      if (request.method !== 'POST') {
        return accountJsonResponse({ error: 'method_not_allowed' }, 405);
      }

      const parsedRes = await parseStrictJsonObject(request);
      if (!parsedRes.ok) {
        return accountJsonResponse({ error: parsedRes.error }, parsedRes.status);
      }
      const body = parsedRes.body;

      // Strict contract: MUST have EXACTLY one key: eventType
      const keys = Object.keys(body);
      if (keys.length !== 1 || keys[0] !== 'eventType') {
        return accountJsonResponse({ error: 'invalid_payload' }, 400);
      }

      if (!isAllowedEventType(body.eventType)) {
        return accountJsonResponse({ error: 'invalid_event_type' }, 400);
      }

      const eventType: AllowedEventType = body.eventType;
      const now = new Date();
      const usageDate = now.toISOString().slice(0, 10); // YYYY-MM-DD UTC
      const nowIso = now.toISOString();
      const rowId = crypto.randomUUID();

      // Atomic UPSERT
      await env.DB.prepare(`
        INSERT INTO "account_usage" ("id", "userId", "usageDate", "eventType", "count", "createdAt", "updatedAt")
        VALUES (?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT ("userId", "usageDate", "eventType")
        DO UPDATE SET
          "count" = "account_usage"."count" + 1,
          "updatedAt" = excluded."updatedAt"
      `).bind(rowId, userId, usageDate, eventType, nowIso, nowIso).run();

      return accountJsonResponse({ ok: true, eventType, usageDate });
    }

    // 5. GET /api/account/entitlement
    if (pathname === '/api/account/entitlement') {
      if (request.method !== 'GET') {
        return accountJsonResponse({ error: 'method_not_allowed' }, 405);
      }

      // Security: userId is taken strictly from the authenticated session, never from query or body
      const queryResult = await env.DB.prepare(
        'SELECT "userId", "plan", "status", "source", "startsAt", "endsAt", "createdAt", "updatedAt" FROM "account_entitlement" WHERE "userId" = ?'
      ).bind(userId).all<RawEntitlementRow>();

      const row = (queryResult.results?.[0] as RawEntitlementRow | undefined) ?? null;
      const resolution = resolveEffectiveEntitlement(row);
      return accountJsonResponse(resolution);
    }

    // 6. DELETE /api/account
    if (pathname === '/api/account') {
      if (request.method !== 'DELETE') {
        return accountJsonResponse({ error: 'method_not_allowed' }, 405);
      }

      const parsedRes = await parseStrictJsonObject(request);
      if (!parsedRes.ok) {
        return accountJsonResponse({ error: parsedRes.error }, parsedRes.status);
      }
      const body = parsedRes.body;

      // Strict contract: MUST have EXACTLY one key: confirmation === 'delete-account'
      const keys = Object.keys(body);
      if (keys.length !== 1 || keys[0] !== 'confirmation') {
        return accountJsonResponse({ error: 'invalid_payload' }, 400);
      }

      if (body.confirmation !== 'delete-account') {
        return accountJsonResponse({ error: 'invalid_confirmation' }, 400);
      }

      // Atomic Batch Transaction in D1
      // If any statement in env.DB.batch fails, the entire batch transaction rolls back!
      await env.DB.batch([
        env.DB.prepare('DELETE FROM "account_entitlement" WHERE "userId" = ?').bind(userId),
        env.DB.prepare('DELETE FROM "account_usage" WHERE "userId" = ?').bind(userId),
        env.DB.prepare('DELETE FROM "session" WHERE "userId" = ?').bind(userId),
        env.DB.prepare('DELETE FROM "account" WHERE "userId" = ?').bind(userId),
        env.DB.prepare('DELETE FROM "user" WHERE "id" = ?').bind(userId),
      ]);

      const headers = new Headers();
      headers.append(
        'Set-Cookie',
        'better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'
      );
      headers.append(
        'Set-Cookie',
        '__Secure-better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure'
      );

      return accountJsonResponse({ ok: true, message: 'account_deleted' }, 200, headers);
    }

    return accountJsonResponse({ error: 'not_found' }, 404);
  } catch {
    return accountJsonResponse({ error: 'server_error' }, 500);
  }
}
