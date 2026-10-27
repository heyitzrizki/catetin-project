# Stage 4 Account and Monetization Design

**Date:** 2026-10-27

## Intent

Catetin needs accounts and a sustainable Free/Pro business model without turning local recordings, audio, transcripts, projects, folders, or tags into cloud data. Accounts should add identity, entitlement, payment history, privacy-safe usage history, and optional paid services while the core editor remains usable as a guest.

## Goals

- Add Google sign-in on a Cloudflare-native backend.
- Keep the local Studio usable without an account and during cloud outages.
- Store only account, session, entitlement, transaction, consent, and minimal usage data in the cloud.
- Launch in Indonesia with rupiah pricing and manual prepaid renewal through QRIS or virtual account.
- Make Cloud Assist optional and explicit when it is introduced later.
- Stay within Cloudflare's Free plan until measured usage or revenue justifies a manual upgrade.

## Non-goals

- Cloud sync for projects or recordings.
- Uploading audio, transcript text, filenames, project names, folders, or tags.
- Google Drive import.
- Automatic subscription renewal or stored cards.
- International checkout or multiple currencies.
- Cloud Assist implementation.

## Chosen Approach

Build Stage 4 as small vertical slices. Each slice must create a complete, reviewable user outcome and preserve guest/local operation.

Alternatives considered:

1. Build database, API, auth, billing, and UI as separate technical layers. This is orderly but delays a testable user flow.
2. Build vertical slices. Chosen because each commit can be tested end to end and paused safely.
3. Build all account and monetization functionality at once. Rejected because it increases review risk, context use, and hidden coupling.

## Architecture

- **Frontend:** the existing React/Vite SPA and local IndexedDB workspace remain authoritative for user content.
- **API:** a Cloudflare Worker handles only `/api/*`; static assets remain served by Cloudflare Assets.
- **Authentication:** Better Auth with Google OAuth and server-managed sessions.
- **Database:** Cloudflare D1 stores account-side records only.
- **Abuse protection:** Cloudflare Turnstile and rate limiting are added to risky endpoints during hardening, not inserted indiscriminately into ordinary local use.
- **Payments:** an Indonesian gateway is selected in Stage 4C. Signed webhooks grant time-bounded Pro entitlement.

## Cloud Data Boundary

Allowed cloud data:

- Stable account ID, email, display name, and Google avatar.
- Account creation and last-login timestamps.
- Session and coarse device/session metadata needed for account security.
- Plan, entitlement start/end, payment status, and gateway transaction references.
- Aggregate feature counters and minimal operational events.
- Consent and account preferences.

Forbidden cloud data:

- Audio or derived audio samples.
- Transcript text or speaker names.
- Recording/file/project/folder/tag names or IDs copied from the local workspace.
- Search queries entered into local workspace search.
- User content in analytics, error payloads, or server logs.

## Stage Breakdown

### 4A: Account Foundation

Add the Worker API seam, D1, Better Auth, Google sign-in/out, session restoration, and a minimal account control. Guest use remains the default and no billing is introduced.

### 4B: Account and Usage

Add the account page, active sessions, safe usage history, session revocation, and account deletion flow. Usage records contain counters and timestamps only.

### 4C: Free/Pro and Manual Payment

Define the final rupiah price and gateway, then implement QRIS/VA checkout, signed and idempotent webhooks, time-bounded entitlement, payment history, expiry reminders, and manual renewal. There is no auto-debit or stored card.

### 4D: Analytics and Quota

Add privacy-safe anonymous analytics for guests, account-level aggregate usage, server-enforced quotas for paid external services, retention rules, and Cloudflare usage monitoring. Do not persist every interaction as an indefinite event.

### 4E: Trust and Support

Add concise local-first and Cloud Assist explanations, open-source licenses, a short Whisper explainer, support/bug-report email flow, and human-readable payment and refund policies.

### 4F: Production Hardening

Audit OAuth and cookies, add targeted Turnstile/rate limits, protect webhook replay, sanitize logs, test degraded operation, document D1 migration/backup recovery, and complete the production launch checklist.

## Experience Rules

- A guest can open and use the local Studio without a sign-in wall.
- Signing in must never upload or rename local workspace content.
- Auth loading, failure, and offline states must not blank the application.
- Account UI must state what is and is not stored in the cloud.
- Every account action needs loading, success, failure, keyboard, and narrow-screen behavior.
- UI follows the existing Catetin brand and repository anti-slop rules.

## Operational Rules

- Cloudflare plan changes are manual owner decisions and never tied automatically to a user buying Pro.
- Secrets are configured through Cloudflare secrets and local ignored development files, never client environment variables or Git.
- Database changes use versioned D1 migrations.
- Production callback origins use an explicit allowlist.
- Account deletion must not imply deletion of local browser data; the two actions are explained separately.

## Decisions Deferred to Their Owning Slice

- Stage 4C: Indonesian payment gateway, exact rupiah price, validity periods, and refund rules.
- Stage 4D: analytics provider/primitive, retention duration, and exact Free/Pro quotas.
- Stage 4E: support email provider and final legal copy.

