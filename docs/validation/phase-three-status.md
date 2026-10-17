# Phase 3: payments and entitlements

Scope: approved implementation-plan Tasks 8–9, plus the user's optional email addition. Independent MIT repository; every derived application supplies its own Stripe/Cloudflare/Supabase accounts. The user initially accepted local-only validation, then authorized creating an isolated Stripe Sandbox and saving test credentials locally. No real email domain was authorized or bound.

Implemented: optional single-currency monthly subscription and credit pack, owned catalog/Portal/Webhook initialization, persistent checkout operations, raw signed webhook inbox, fenced canonical reconciliation, per-source credit/feature ledger, source-specific refunds/disputes, audited administrator recovery/adjustments, bilingual pricing/billing/return/admin UI, and one bounded Scheduled handler.

Initial red test: importing the missing billing module failed before implementation. Local baseline completed before changes. Build/setup tests and the first full application suite passed; final post-review verification is recorded below before delivery.

The dedicated billing browser flow already passed with actual Supabase Auth, Worker APIs, D1 migrations, signed Webhook and persisted purchase/refund effects. Only the external payment supplier was replaced with an explicit loopback simulator; no browser route mocks or real card/charge were used. Visual inspection covered the actual rendered billing page. This is local business evidence, not Stripe evidence.

## Evidence limits

- A fresh isolated anonymous Stripe Sandbox was created through CLI 1.54.0 with a dedicated private config. Test keys were saved only in ignored `.dev.vars.dev`; the existing CLI profile remained unchanged. It expires on 2026-10-24. Six read-only resource-list API checks returned 200; account/balance queries required by full initialization were denied by its restricted key. The user is completing separate existing-account authorization to create a managed Sandbox. Raw keys and claim links are not evidence artifacts.
- Real Stripe catalog/account isolation, hosted Checkout/Portal completion and purchase/renewal/cancellation/refund: **unverified pending full Sandbox authorization**. Read-only list access does not pass payment gates.
- The opt-in real Sandbox suite was run against that isolated anonymous key: **failed at account-permission admission**, before any product/price/customer/Checkout/payment mutation. This is a non-passing gate, not a skipped or passing payment test. A fresh run is required after full account authorization.
- Provider-to-Cloudflare callback delivery and Phase 3 cloud CPU/bundle/request limits: **unverified**. Local build/signature tests do not prove Free viability.
- Production/live charges: not created or tested.
- Agent execution, reservations and successful-step settlement: Phase 4, not implemented or claimed here.
- Historical Phase 1 Better Auth Free CPU gate remains failed; changing authentication architecture does not rewrite it.

Use [billing setup and recovery](../billing.md) to run your own isolated Sandbox validation before relying on payment acceptance. No unavailable gate is relabeled as passed.

## Local verification after review

| Check | Result |
|---|---|
| Full TypeScript checks | passed |
| Full `npm test` | 111 passed: 16 build/setup, 34 application integration, 61 historical regression |
| Production build | passed; Worker 1,769.99 kB raw / 347.32 kB gzip; this is not cloud CPU evidence |
| Existing invite/workspace browser suite | 3 passed |
| Public signup/recovery browser suite | 1 passed; invite mode restored |
| Final billing browser suite | 1 passed, including expired-operation recovery, purchase, persistence, signed callback, source refund, mobile layout and non-admin denial |
| Independent whole Phase 3 review | seven findings fixed; relevant new regression cases failed before fixes and passed afterward |
| Focused review of subsequently added email | pagination and routing readiness findings fixed with regression coverage |
| Optional-email default command | exits cleanly without credentials or domain actions |

Email tests cover the parent project's Resend configuration/content/error contract, modern TXT/MX/CNAME setup, exact reuse, conflicts, 50-item pagination, destination verification and apex-only forwarding readiness. Sending helper has no public arbitrary-send route. Supabase Auth remains responsible for authentication email; existing real Auth/Mailpit browser tests pass. Live domain DNS, forwarding, Resend acceptance/inbox delivery and hosted SMTP are **unverified**, per the user's explicit template-only scope.

`npm run test:sandbox` is an explicit opt-in runner, excluded from local `npm test`. It requires an own-account full test key and `STRIPE_SANDBOX_ACCOUNT_ID`; validates account/mode before mutation, then uses actual Stripe APIs plus real local Auth/API/D1. Its webhook signatures are deliberately synthetic, so it cannot prove provider-to-Worker delivery or hosted Checkout completion even after passing. No synthetic readiness row is used by production setup.
