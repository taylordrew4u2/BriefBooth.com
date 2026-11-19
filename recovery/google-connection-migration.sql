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
