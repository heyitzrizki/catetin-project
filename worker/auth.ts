import { betterAuth } from 'better-auth';
import type { Env } from './env.ts';
import {
  getTrustedOrigins,
  isOriginAllowed,
  isRedirectAllowed,
  normalizeOrigin,
  configurationProblem,
  jsonResponse,
} from './http.ts';

export function createAuth(env: Env) {
  const canonicalBaseURL = normalizeOrigin(env.APP_ORIGIN!);
  const trustedOrigins = getTrustedOrigins(canonicalBaseURL);

  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: canonicalBaseURL,
    trustedOrigins,
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID || '',
        clientSecret: env.GOOGLE_CLIENT_SECRET || '',
      },
    },
  });
}

export async function handleAuthRequest(request: Request, env: Env): Promise<Response> {
  const problem = configurationProblem(env);
  if (problem) {
    return jsonResponse({ error: 'configuration_error', message: problem }, 500);
  }

  const canonical = normalizeOrigin(env.APP_ORIGIN!);

  const origin = request.headers.get('Origin');
  if (origin && !isOriginAllowed(origin, canonical)) {
    return jsonResponse({ error: 'untrusted_origin' }, 403);
  }

  const url = new URL(request.url);
  const queryCallback = url.searchParams.get('callbackURL') || url.searchParams.get('redirectTo');
  if (queryCallback && !isRedirectAllowed(queryCallback, canonical)) {
    return jsonResponse({ error: 'untrusted_redirect' }, 403);
  }

  if (request.method === 'POST') {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        const cloned = request.clone();
        const body = await cloned.json();
        if (body && typeof body === 'object') {
          const bodyCallback = (body as any).callbackURL || (body as any).redirectTo;
          if (bodyCallback && !isRedirectAllowed(bodyCallback, canonical)) {
            return jsonResponse({ error: 'untrusted_redirect' }, 403);
          }
        }
      } catch {
        // Handled by auth handler
      }
    }
  }

  try {
    const auth = createAuth(env);
    return await auth.handler(request);
  } catch {
    return jsonResponse({ error: 'auth_error' }, 500);
  }
}
