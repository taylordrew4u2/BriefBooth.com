-- Additive, replay-safe diagnostics. No raw state, account identity, credential,
-- request URL or provider payload belongs here. Handshake secrets expire normally.
CREATE TABLE IF NOT EXISTS recovery_google_failures (
 operation_hash TEXT PRIMARY KEY,
 failed_ms INTEGER NOT NULL,
 diagnostic TEXT NOT NULL CHECK(length(diagnostic)<=1024)
);
CREATE INDEX IF NOT EXISTS recovery_google_failures_time ON recovery_google_failures(failed_ms);
