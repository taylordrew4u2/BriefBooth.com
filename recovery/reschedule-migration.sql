-- Apply once before deploying rescheduling support. Existing rows remain version zero.
ALTER TABLE recovery_bookings ADD COLUMN notification_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recovery_emails ADD COLUMN booking_version INTEGER NOT NULL DEFAULT 0;
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
