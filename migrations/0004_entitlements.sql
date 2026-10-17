CREATE TABLE billing_events (
 event_id TEXT PRIMARY KEY, type TEXT NOT NULL, object_id TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'received', attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 error_code TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX billing_retry ON billing_events(state,next_attempt_at,lease_until);
CREATE TABLE entitlement_sources (
 source_key TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
 price_id TEXT, payment_intent TEXT, subscription_id TEXT, credits INTEGER NOT NULL, remaining INTEGER NOT NULL CHECK(remaining>=0),
 features TEXT NOT NULL, valid_from INTEGER NOT NULL DEFAULT 0, valid_until INTEGER,
 state TEXT NOT NULL DEFAULT 'active', review_reason TEXT, review_fingerprint TEXT, resolved_fingerprint TEXT, refunded INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, reconcile_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX entitlement_owner ON entitlement_sources(user_id,state,valid_until);
CREATE INDEX entitlement_payment ON entitlement_sources(payment_intent);
CREATE UNIQUE INDEX entitlement_period ON entitlement_sources(user_id,valid_from,valid_until) WHERE kind='subscription';
CREATE TABLE entitlement_ledger (
 operation_key TEXT PRIMARY KEY, source_key TEXT NOT NULL REFERENCES entitlement_sources(source_key),
 quantity INTEGER NOT NULL, action TEXT NOT NULL, actor_id TEXT, reason TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE billing_adjustments (
 operation_id TEXT PRIMARY KEY, source_key TEXT NOT NULL, quantity INTEGER NOT NULL,
 actor_id TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL, resolution TEXT
);
INSERT INTO schema_version VALUES(4);
