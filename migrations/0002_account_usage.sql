-- Migration 0002_account_usage.sql
-- Catetin Stage 4B: Privacy-safe per-account aggregate usage counters for Cloudflare D1
-- Note: Catetin follows the local-first rule for workspaces: recordings, audio,
-- transcripts, project names, folder names, and search terms stay on the local device.
-- Account metadata and coarse daily aggregate activity counters are stored in the cloud.

CREATE TABLE IF NOT EXISTS "account_usage" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "usageDate" TEXT NOT NULL,
  "eventType" TEXT NOT NULL CHECK ("eventType" IN ('local_transcription_completed', 'transcript_export_completed', 'catetin_backup_completed')),
  "count" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "uq_account_usage_user_date_event" UNIQUE ("userId", "usageDate", "eventType")
);

CREATE INDEX IF NOT EXISTS "idx_account_usage_user_date" ON "account_usage"("userId", "usageDate" DESC);
