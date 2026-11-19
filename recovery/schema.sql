-- Dedicated, isolated recovery data. Apply only to the RECOVERY_DB D1 binding.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS recovery_configuration (
 owner_id TEXT PRIMARY KEY,
 revision INTEGER NOT NULL CHECK(revision>0),
 config_json TEXT NOT NULL CHECK(json_valid(config_json)),
 updated_ms INTEGER NOT NULL,
 updated_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recovery_bookings (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 service_id TEXT NOT NULL,
 title TEXT NOT NULL,
 starts_ms INTEGER NOT NULL,
 ends_ms INTEGER NOT NULL CHECK (ends_ms > starts_ms),
 client_name TEXT NOT NULL,
 client_email TEXT NOT NULL,
 notes TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN ('pending_approval','confirming','confirmed','declined','cancelling','cancelled')),
 request_id TEXT UNIQUE,
 request_hash TEXT,
 client_token_hash TEXT UNIQUE,
 source TEXT NOT NULL DEFAULT 'recovery' CHECK(source IN ('recovery','supabase')),
 event_id TEXT,
 meeting_url TEXT,
 meeting_error TEXT CHECK(meeting_error IS NULL OR meeting_error='google_meet_failed'),
 created_ms INTEGER NOT NULL,
 updated_ms INTEGER NOT NULL,
 notification_version INTEGER NOT NULL DEFAULT 0,
 action_nonce TEXT,
 action_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS recovery_bookings_owner_time ON recovery_bookings(owner_id, starts_ms, ends_ms);
CREATE INDEX IF NOT EXISTS recovery_bookings_status_time ON recovery_bookings(owner_id,status,starts_ms);
CREATE INDEX IF NOT EXISTS recovery_bookings_owner_created ON recovery_bookings(owner_id,created_ms DESC,id DESC);
CREATE INDEX IF NOT EXISTS recovery_bookings_client_history ON recovery_bookings(owner_id,client_email,created_ms DESC,id DESC) WHERE source='recovery';
CREATE TABLE IF NOT EXISTS recovery_rate_limits (
 bucket TEXT PRIMARY KEY,
 count INTEGER NOT NULL,
 expires_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS recovery_rate_expiry ON recovery_rate_limits(expires_ms);
CREATE TABLE IF NOT EXISTS recovery_emails (
 id TEXT PRIMARY KEY,
 booking_id TEXT NOT NULL REFERENCES recovery_bookings(id),
 kind TEXT NOT NULL,
 recipient TEXT NOT NULL,
 subject TEXT NOT NULL,
 body TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','sent','uncertain','superseded')),
 created_ms INTEGER NOT NULL,
 sent_ms INTEGER,
 delivery_status TEXT NOT NULL DEFAULT 'unknown',
 attempt_count INTEGER NOT NULL DEFAULT 0,
 send_started_ms INTEGER NOT NULL DEFAULT 0,
 next_attempt_ms INTEGER NOT NULL DEFAULT 0,
 last_error TEXT,
 booking_version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS recovery_emails_booking_state ON recovery_emails(booking_id,state);
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
CREATE TABLE IF NOT EXISTS recovery_reschedule_operations (
 operation_id TEXT PRIMARY KEY,
 booking_id TEXT NOT NULL REFERENCES recovery_bookings(id),
 request_hash TEXT NOT NULL,
 previous_starts_ms INTEGER NOT NULL,
 previous_ends_ms INTEGER NOT NULL,
 starts_ms INTEGER NOT NULL,
 ends_ms INTEGER NOT NULL CHECK(ends_ms>starts_ms),
 state TEXT NOT NULL CHECK(state IN ('reserved','applying','complete','failed','cancelled')),
 google_etag TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 created_ms INTEGER NOT NULL,
 updated_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS recovery_one_active_reschedule ON recovery_reschedule_operations(booking_id) WHERE state IN ('reserved','applying');
CREATE INDEX IF NOT EXISTS recovery_reschedule_time ON recovery_reschedule_operations(state,starts_ms,ends_ms);

-- Additive owner-only OAuth state; existing bookings and credentials are untouched.
CREATE TABLE IF NOT EXISTS recovery_google_credentials (
 owner_id TEXT PRIMARY KEY,
 revision INTEGER NOT NULL CHECK(revision > 0),
 token_ciphertext TEXT NOT NULL,
 updated_ms INTEGER NOT NULL,
 operation_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recovery_google_handshakes (
 state_hash TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 browser_hash TEXT NOT NULL,
 baseline_revision INTEGER NOT NULL CHECK(baseline_revision >= 0),
 verifier_ciphertext TEXT NOT NULL,
 candidate_ciphertext TEXT,
 phase TEXT NOT NULL CHECK(phase IN ('pending','processing','ready','completed','failed')),
 expires_ms INTEGER NOT NULL,
 completed_revision INTEGER,
 created_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS recovery_google_handshakes_expiry ON recovery_google_handshakes(expires_ms);
