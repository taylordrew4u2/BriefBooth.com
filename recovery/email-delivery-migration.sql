-- Run once against the existing RECOVERY_DB. New databases use schema.sql.
-- Legacy sent rows stay unknown; they have no provider ID and must not be resent.
ALTER TABLE recovery_emails ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE recovery_emails ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recovery_emails ADD COLUMN send_started_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recovery_emails ADD COLUMN next_attempt_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recovery_emails ADD COLUMN last_error TEXT;
CREATE TABLE IF NOT EXISTS recovery_email_attempts (
 id TEXT PRIMARY KEY,
 email_id TEXT NOT NULL REFERENCES recovery_emails(id),
 attempt_number INTEGER NOT NULL,
 started_ms INTEGER NOT NULL,
 provider_message_id TEXT UNIQUE,
 outcome TEXT NOT NULL DEFAULT 'sending',
 last_checked_ms INTEGER NOT NULL DEFAULT 0,
 UNIQUE(email_id,attempt_number)
);
