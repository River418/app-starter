CREATE TABLE probe_state (id INTEGER PRIMARY KEY CHECK (id = 1), initialized INTEGER NOT NULL DEFAULT 0);
INSERT INTO probe_state (id, initialized) VALUES (1, 0);
CREATE TABLE probe_records (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL);
CREATE TABLE probe_workflow_results (instance_id TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE probe_stripe_events (id TEXT PRIMARY KEY, kind TEXT NOT NULL);
