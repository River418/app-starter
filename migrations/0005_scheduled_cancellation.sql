-- Flexible billing schedules cancellation through cancel_at rather than cancel_at_period_end.
ALTER TABLE billing_subscriptions ADD COLUMN cancel_at INTEGER;
UPDATE billing_subscriptions SET cancel_at=period_end WHERE cancel_at_period_end=1;
INSERT INTO schema_version VALUES(5);
