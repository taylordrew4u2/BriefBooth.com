-- Dedicated, isolated recovery data. Apply only to the RECOVERY_DB D1 binding.
PRAGMA foreign_keys = ON;
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
 created_ms INTEGER NOT NULL,
 updated_ms INTEGER NOT NULL,
 action_nonce TEXT,
 action_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS recovery_bookings_owner_time ON recovery_bookings(owner_id, starts_ms, ends_ms);
CREATE INDEX IF NOT EXISTS recovery_bookings_status_time ON recovery_bookings(owner_id,status,starts_ms);
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
 sent_ms INTEGER
);
CREATE INDEX IF NOT EXISTS recovery_emails_booking_state ON recovery_emails(booking_id,state);
