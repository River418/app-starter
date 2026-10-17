CREATE TABLE model_threads (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, scenario TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'idle',
  version INTEGER NOT NULL DEFAULT 1, messages_json TEXT NOT NULL DEFAULT '[]',
  value TEXT NOT NULL DEFAULT 'initial', writes INTEGER NOT NULL DEFAULT 0, run_nonce TEXT
);
CREATE TABLE model_runs (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES model_threads(id), state TEXT NOT NULL DEFAULT 'running',
  model_calls INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
  text_deltas INTEGER NOT NULL DEFAULT 0, first_delta_ms REAL, last_delta_ms REAL,
  request_aborted INTEGER NOT NULL DEFAULT 0, provider_aborted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE model_approvals (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES model_threads(id), tool_call_id TEXT NOT NULL,
  input_json TEXT NOT NULL, decision INTEGER, decision_token TEXT, executed INTEGER NOT NULL DEFAULT 0,
  execution_token TEXT, expires_at INTEGER NOT NULL, UNIQUE(thread_id, tool_call_id)
);
CREATE TABLE model_workflow_owners (instance_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, thread_id TEXT NOT NULL REFERENCES model_threads(id));
