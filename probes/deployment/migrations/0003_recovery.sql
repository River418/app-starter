CREATE TABLE recovery_runs (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, operation_id TEXT NOT NULL,
  approval INTEGER NOT NULL, mode TEXT NOT NULL DEFAULT 'normal',
  state TEXT NOT NULL CHECK(state IN ('queued','running','waiting_approval','approved','succeeded','cancelled','failed','expired')),
  phase TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, transition_token TEXT NOT NULL,
  lease_fence INTEGER NOT NULL DEFAULT 0, lease_until INTEGER,
  approval_id TEXT, approval_version INTEGER, approval_expires_at INTEGER, approved_at INTEGER,
  deadline_at INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(owner_id, operation_id)
);
CREATE TABLE recovery_reservations (
  run_id TEXT PRIMARY KEY REFERENCES recovery_runs(id), reserved INTEGER NOT NULL CHECK(reserved >= 0),
  consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed >= 0), released INTEGER NOT NULL DEFAULT 0 CHECK(released >= 0),
  slot_active INTEGER NOT NULL DEFAULT 1 CHECK(slot_active IN (0,1)),
  CHECK(consumed + released <= reserved)
);
CREATE TABLE recovery_outbox (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES recovery_runs(id),
  kind TEXT NOT NULL CHECK(kind IN ('start','confirm')), state TEXT NOT NULL DEFAULT 'pending',
  lease_token TEXT, lease_until INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), next_attempt_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(run_id, kind)
);
CREATE INDEX recovery_outbox_due ON recovery_outbox(state, next_attempt_at, lease_until);
CREATE TABLE recovery_results (run_id TEXT PRIMARY KEY REFERENCES recovery_runs(id), value TEXT NOT NULL);
CREATE TABLE recovery_usage (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES recovery_runs(id), kind TEXT NOT NULL,
  step_key TEXT NOT NULL, units INTEGER NOT NULL CHECK(units >= 0), cost_units INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX recovery_step_once ON recovery_usage(run_id, step_key) WHERE kind = 'user_step';
