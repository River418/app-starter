CREATE TABLE billing_state (
 id INTEGER PRIMARY KEY CHECK(id=1), namespace TEXT NOT NULL, account_id TEXT NOT NULL,
 livemode INTEGER NOT NULL, config_hash TEXT NOT NULL, key_hash TEXT NOT NULL,
 origin TEXT NOT NULL, portal_id TEXT NOT NULL, endpoint_id TEXT NOT NULL DEFAULT '', secret_hash TEXT NOT NULL DEFAULT '', ready INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE billing_prices (
 price_id TEXT PRIMARY KEY, namespace TEXT NOT NULL, plan_key TEXT NOT NULL,
 version TEXT NOT NULL, currency TEXT NOT NULL, amount_minor INTEGER NOT NULL,
 credits INTEGER NOT NULL, features TEXT NOT NULL, tax_behavior TEXT NOT NULL,
 UNIQUE(namespace,plan_key,version)
);
CREATE TABLE billing_customers (
 user_id TEXT PRIMARY KEY REFERENCES members(user_id), customer_id TEXT NOT NULL UNIQUE
);
CREATE TABLE billing_locks(user_id TEXT PRIMARY KEY,lease_token TEXT,lease_until INTEGER NOT NULL DEFAULT 0);
CREATE TABLE billing_orders (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 plan_key TEXT NOT NULL, price_id TEXT NOT NULL REFERENCES billing_prices(price_id),
 session_id TEXT UNIQUE, payment_intent TEXT UNIQUE, subscription_id TEXT,
 url TEXT, state TEXT NOT NULL DEFAULT 'creating', created_at INTEGER NOT NULL, reconcile_at INTEGER NOT NULL DEFAULT 0,
 UNIQUE(user_id,operation_id)
);
CREATE UNIQUE INDEX billing_pending_subscription ON billing_orders(user_id) WHERE plan_key='monthly' AND state IN('creating','open','processing');
CREATE TABLE billing_subscriptions (
 subscription_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 price_id TEXT NOT NULL, status TEXT NOT NULL, period_start INTEGER NOT NULL,
 period_end INTEGER NOT NULL, cancel_at_period_end INTEGER NOT NULL,
 reconcile_at INTEGER NOT NULL
);
INSERT INTO schema_version VALUES(3);
