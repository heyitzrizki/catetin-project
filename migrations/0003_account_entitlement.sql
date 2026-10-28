-- Migration 0003_account_entitlement.sql
-- Catetin Stage 4C1: Free/Pro Entitlement Foundation for Cloudflare D1
-- Note: Catetin follows the local-first zero-cloud rule for workspaces.
-- Speech, transcripts, audio files, project titles, and folder names stay local.
-- This table stores minimal cloud entitlement status per account without transaction or checkout data.

CREATE TABLE IF NOT EXISTS "account_entitlement" (
  "userId" TEXT PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "plan" TEXT NOT NULL CHECK ("plan" IN ('pro')),
  "status" TEXT NOT NULL CHECK ("status" IN ('active', 'grace', 'expired', 'revoked')),
  "source" TEXT NOT NULL CHECK ("source" IN ('promotion', 'admin', 'midtrans')),
  "startsAt" TEXT NOT NULL,
  "endsAt" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_account_entitlement_status" ON "account_entitlement"("status");
