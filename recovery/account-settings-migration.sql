-- Additive only: no booking/auth/credential changes, no legacy guard changes.
-- The new worker seeds this row once, atomically, from the existing live
-- RECOVERY_CONFIG_JSON snapshot. Later environment changes never overwrite it.
CREATE TABLE IF NOT EXISTS recovery_configuration (
 owner_id TEXT PRIMARY KEY,
 revision INTEGER NOT NULL CHECK(revision>0),
 config_json TEXT NOT NULL CHECK(json_valid(config_json)),
 updated_ms INTEGER NOT NULL,
 updated_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS recovery_bookings_client_history ON recovery_bookings(owner_id,client_email,created_ms DESC,id DESC) WHERE source='recovery';
