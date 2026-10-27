# Stage 4A Account Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Cloudflare-native Google sign-in foundation while preserving Catetin's fully usable guest and local-first Studio.

**Architecture:** Add a Worker entrypoint that owns `/api/*` and delegates all other requests to the existing static-assets binding. Better Auth receives the D1 binding directly and manages Google OAuth plus server-side sessions; the React client exposes a small account control and treats auth failure as a non-blocking guest state.

**Tech Stack:** React 19, TypeScript, Vite, Cloudflare Workers Static Assets, Cloudflare D1, Better Auth, Google OAuth, Node test runner via `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-27-stage-4-account-monetization-design.md`

## Global Constraints

- Never send local audio, transcripts, recording metadata, project metadata, folder names, tags, or local search queries to `/api/*`.
- Guest Studio functionality must remain usable when the account API is offline, misconfigured, or returns an error.
- Serve ordinary static assets without invoking Worker code unnecessarily; Worker-first routing is limited to `/api/*`.
- Store Google client secret and Better Auth secret only as Worker secrets; do not expose them through Vite variables.
- Allow OAuth redirects only to explicit local and production Catetin origins.
- Use versioned D1 migrations; do not create schema at request time.
- Do not add payment, entitlement, analytics, Cloud Assist, Google Drive, email/password login, or account-dashboard scope in 4A.
- Preserve all existing untracked `.design/` files and unrelated planning documents.
- Follow `AGENTS.md`, including real interactions, loading/error states, keyboard access, 44px targets, WCAG AA, and no fabricated claims.

## Review Focus

- Auth API unavailable: application renders and local Studio remains usable as guest.
- Forged cross-origin callback or return URL: request is rejected rather than redirected off-site.
- Expired or malformed session cookie: safe unauthenticated response, no application crash.
- Missing Worker secret or D1 binding: API returns a sanitized configuration error without leaking values.
- Repeated sign-in/sign-out and narrow viewport: no duplicate actions, inaccessible state, or lost local workspace.

---

### Task 1: Establish the Worker and API boundary

**Files:**
- Create: `worker/index.ts`
- Create: `worker/env.ts`
- Create: `tests/account/worker-routing.test.ts`
- Modify: `wrangler.jsonc`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`

**Interfaces:**
- Produces: `Env` with `ASSETS: Fetcher`, `DB: D1Database`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `APP_ORIGIN`.
- Produces: Worker `fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>`.
- Produces: `GET /api/health` response `{ ok: true }` without account or environment details.

- [ ] **Step 1: Write failing routing tests**

Cover `GET /api/health`, an unknown `/api/*` returning JSON `404`, and a non-API request delegating exactly once to `env.ASSETS.fetch(request)`.

- [ ] **Step 2: Run the targeted test and confirm it fails**

Run: `npx.cmd tsx --test tests/account/worker-routing.test.ts`

Expected: FAIL because `worker/index.ts` does not exist.

- [ ] **Step 3: Add the Worker seam and Cloudflare types**

Add a module Worker entrypoint and configure an `ASSETS` binding with Worker-first routing limited to `/api/*`. Add only the Cloudflare development dependencies required to type and locally run the Worker; keep the existing SPA fallback behavior.

- [ ] **Step 4: Run the targeted test**

Run: `npx.cmd tsx --test tests/account/worker-routing.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the routing boundary**

Commit message: `feat: add account API worker boundary`

### Task 2: Add the D1-backed Better Auth server

**Files:**
- Create: `worker/auth.ts`
- Create: `worker/http.ts`
- Create: `migrations/0001_better_auth.sql`
- Create: `tests/account/auth-server.test.ts`
- Modify: `worker/index.ts`
- Modify: `wrangler.jsonc`
- Modify: `.env.example`
- Modify: `.gitignore` if local Worker secret files are not already ignored
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `Env` from Task 1.
- Produces: `createAuth(env: Env, request: Request)` configured with `database: env.DB`, Google social provider, explicit base URL/origin, and explicit trusted origins.
- Produces: `handleAuthRequest(request: Request, env: Env): Promise<Response>` for `/api/auth/*`.
- Produces: `configurationProblem(env: Env): string | null`, returning field names only and never secret values.

- [ ] **Step 1: Pin Better Auth and write failing server tests**

Test that auth routes are delegated, non-allowlisted origins are rejected, missing bindings produce sanitized JSON, and secret values never occur in a response body. Include the malformed/expired session case as an unauthenticated response.

- [ ] **Step 2: Run the targeted tests and confirm they fail**

Run: `npx.cmd tsx --test tests/account/auth-server.test.ts`

Expected: FAIL because the auth server is not implemented.

- [ ] **Step 3: Generate and review the pinned Better Auth D1 schema**

Generate the migration using the installed Better Auth version. Commit the generated, versioned SQL after confirming it contains only Better Auth account/session/verification tables and indexes. Do not add Catetin content tables.

- [ ] **Step 4: Implement the auth factory and route adapter**

Use Better Auth's native D1 support. Configure Google OAuth, secure HTTP-only session cookies, same-site behavior suitable for same-origin OAuth callbacks, and exact trusted origins for local and production Catetin. Return generic client errors and keep detailed values out of logs.

- [ ] **Step 5: Run targeted tests and local migration validation**

Run: `npx.cmd tsx --test tests/account/auth-server.test.ts`

Run: `npx.cmd wrangler d1 migrations apply catetin-account --local`

Expected: tests PASS and migration applies cleanly to local D1.

- [ ] **Step 6: Commit the auth server**

Commit message: `feat: add D1-backed Google authentication`

### Task 3: Add a resilient browser auth client

**Files:**
- Create: `src/features/account/auth-client.ts`
- Create: `src/features/account/use-account-session.ts`
- Create: `tests/account/auth-client.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: Better Auth React client with `baseURL` resolved from the current same-origin `/api/auth` path.
- Produces: `AccountSessionState = { status: 'loading' | 'guest' | 'authenticated' | 'unavailable'; user: AccountUser | null }`.
- Produces: `useAccountSession(): AccountSessionState` without reading or serializing local workspace state.

- [ ] **Step 1: Write failing client-state tests**

Cover loading, valid session, no session, malformed server payload, network failure, and recovery after retry. Assert that unavailable state resolves to guest-capable UI rather than throwing.

- [ ] **Step 2: Run the targeted tests and confirm they fail**

Run: `npx.cmd tsx --test tests/account/auth-client.test.ts`

Expected: FAIL because the account client does not exist.

- [ ] **Step 3: Implement the minimal auth client and session state hook**

Keep all auth tokens in Better Auth's server-managed cookie flow. Do not copy access tokens or session tokens to localStorage, IndexedDB, URL parameters, analytics, or application logs.

- [ ] **Step 4: Run the targeted tests**

Run: `npx.cmd tsx --test tests/account/auth-client.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the browser client**

Commit message: `feat: add resilient account session client`

### Task 4: Add the minimal account control without a sign-in wall

**Files:**
- Create: `src/components/account/AccountControl.tsx`
- Create: `tests/account/account-control.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/lib/messages-extra.json`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `useAccountSession()` from Task 3.
- Produces: header account control with guest sign-in, loading, authenticated, sign-out, and unavailable states.
- Produces: Google sign-in callback constrained to a same-origin path.

- [ ] **Step 1: Write failing interaction tests**

Test that guest sees `Masuk`, loading prevents duplicate action, authenticated state shows a safe user label and working `Keluar`, unavailable state explains that local Studio still works, and the control is keyboard accessible at 390px and desktop assumptions. Assert no local workspace object is passed into auth calls.

- [ ] **Step 2: Run the targeted test and confirm it fails**

Run: `npx.cmd tsx --test tests/account/account-control.test.tsx`

Expected: FAIL because `AccountControl` does not exist.

- [ ] **Step 3: Implement and place the account control**

Add the smallest control that fits the existing header hierarchy. Do not redesign navigation or create an account dashboard. Preserve existing brand navigation, language selector, Studio access, and mobile behavior.

- [ ] **Step 4: Run the targeted account tests**

Run: `npx.cmd tsx --test tests/account/*.test.ts tests/account/*.test.tsx`

Expected: all Stage 4A tests PASS.

- [ ] **Step 5: Commit the account UI**

Commit message: `feat: expose optional Google account access`

### Task 5: Verify local-first and deployment readiness

**Files:**
- Create: `docs/account-foundation-operations.md`
- Modify: `README.md`
- Modify: `.env.example`
- Test: all existing and Stage 4A test files

**Interfaces:**
- Consumes: Tasks 1 through 4.
- Produces: exact owner-run setup steps for D1 creation/binding, migration application, Worker secrets, Google OAuth redirect URIs, local development, deployment, rollback, and usage monitoring.

- [ ] **Step 1: Add a privacy-boundary regression test**

Add a source-level or request-capture assertion that account requests contain no workspace stores or fields such as audio blobs, transcripts, projects, folders, tags, filenames, or speaker names.

- [ ] **Step 2: Document owner-operated Cloudflare and Google setup**

Separate commands the implementer may run locally from account mutations the owner must authorize. Use the production callback `/api/auth/callback/google`; document local callback separately. Never include real secret values or database IDs in Git.

- [ ] **Step 3: Run final verification once**

Run: `npm.cmd test`

Run: `npm.cmd run lint`

Run: `npm.cmd run build`

Run: `git diff --check`

Expected: all tests pass, typecheck and build exit 0, and diff-check is clean.

- [ ] **Step 4: Perform a manual local smoke test**

Verify landing and Studio as guest, simulated API outage, Google sign-in, refresh session restoration, sign-out, rejected untrusted return URL, and mobile header. Confirm local IndexedDB workspace is unchanged before and after sign-in.

- [ ] **Step 5: Commit Stage 4A documentation and verification changes**

Commit message: `docs: add account foundation operations guide`

Do not push or deploy until the owner reviews the isolated commits and supplies/approves the account-specific Cloudflare D1 and Google OAuth configuration.
