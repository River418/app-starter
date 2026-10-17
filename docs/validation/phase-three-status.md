# Phase 3: payments and entitlements

Scope: approved implementation-plan Tasks 8–9, plus the user's optional email addition. Independent MIT repository; every derived application supplies its own Stripe/Cloudflare/Supabase accounts. The user initially accepted local-only validation, then authorized a dedicated managed Sandbox under the existing Stripe account, local test-key storage and actual test-mode payment validation. No real email domain was authorized or bound.

Implemented: optional single-currency monthly subscription and credit pack, owned catalog/Portal/Webhook initialization, persistent checkout operations, raw signed webhook inbox, fenced canonical reconciliation, per-source credit/feature ledger, source-specific refunds/disputes, audited administrator recovery/adjustments, bilingual pricing/billing/return/admin UI, and one bounded Scheduled handler.

Initial red test: importing the missing billing module failed before implementation. Local baseline completed before changes. Build/setup tests and the first full application suite passed; final post-review verification is recorded below before delivery.

The dedicated billing browser flow already passed with actual Supabase Auth, Worker APIs, D1 migrations, signed Webhook and persisted purchase/refund effects. Only the external payment supplier was replaced with an explicit loopback simulator; no browser route mocks or real card/charge were used. Visual inspection covered the actual rendered billing page. This is local business evidence, not Stripe evidence.

## Evidence limits

- Historical anonymous CLI admission failed on account/balance permissions, before catalog/payment mutations. The latest user instruction prohibits further anonymous Sandbox use. No requests were made to it after that instruction; its failure remains historical evidence.
- The current CLI login and authenticated Dashboard owner were verified, then a blank, managed `app-starter` Sandbox was created under that owner. Existing standard test keys passed exact-account and `livemode=false` checks before replacing ignored `.dev.vars.dev`. No global CLI profile or existing project was changed; no broader OAuth grant was needed. Account identity/key artifacts remain private.
- Real Stripe catalog reuse/immutable price versioning, hosted Checkout/Portal, purchase, paid first invoice, Test Clock renewal, period-end cancellation and full refund: **passed in that managed Sandbox**. Details and separate delivery scope appear below.
- Provider-to-Cloudflare callback delivery and Phase 3 cloud CPU/bundle/request limits: **unverified**. Local build/signature tests do not prove Free viability.
- Production/live charges: not created or tested.
- Agent execution, reservations and successful-step settlement: Phase 4, not implemented or claimed here.
- Historical Phase 1 Better Auth Free CPU gate remains failed; changing authentication architecture does not rewrite it.

Use [billing setup and recovery](../billing.md) to run your own isolated Sandbox validation before relying on payment acceptance. No unavailable gate is relabeled as passed.

## Local verification after review

| Check | Result |
|---|---|
| Full TypeScript checks | passed |
| Full `npm test` | 112 passed: 16 build/setup, 35 application integration, 61 historical regression |
| Production build | passed; Worker 1,770.15 kB raw / 347.35 kB gzip; this is not cloud CPU evidence |
| Existing invite/workspace browser suite | 3 passed |
| Public signup/recovery browser suite | 1 passed; invite mode restored |
| Final billing browser suite | 1 passed, including expired-operation recovery, purchase, persistence, signed callback, source refund, mobile layout and non-admin denial |
| Independent whole Phase 3 review | seven findings fixed; relevant new regression cases failed before fixes and passed afterward |
| Focused review of subsequently added email | pagination and routing readiness findings fixed with regression coverage |
| Optional-email default command | exits cleanly without credentials or domain actions |

Email tests cover the parent project's Resend configuration/content/error contract, modern TXT/MX/CNAME setup, exact reuse, conflicts, 50-item pagination, destination verification and apex-only forwarding readiness. Sending helper has no public arbitrary-send route. Supabase Auth remains responsible for authentication email; existing real Auth/Mailpit browser tests pass. Live domain DNS, forwarding, Resend acceptance/inbox delivery and hosted SMTP are **unverified**, per the user's explicit template-only scope.

`npm run test:sandbox` is an explicit opt-in runner, excluded from local `npm test`. It requires an own-account full test key and `STRIPE_SANDBOX_ACCOUNT_ID`; validates account/mode before mutation, then uses actual Stripe APIs plus real local Auth/API/D1. Its webhook signatures are deliberately synthetic, so it cannot prove provider-to-Worker delivery or hosted Checkout completion even after passing. No synthetic readiness row is used by production setup.

## Managed Sandbox acceptance — 2026-10-17

The real API suite passed twice; the final run passed in 43.79 seconds after adding actual repeated-catalog and immutable-price assertions. Changing the monthly configuration from 990/100 to 1290/130 created a different Price; the old 990 Price remained unchanged, and restoring the original configuration reused it. The suite also created Checkout/owned Portal sessions, paid a real test subscription invoice, verified duplicate-grant prevention, scheduled cancellation, issued a successful full test refund and cleaned up its subscription/open Checkout. Its synthetic notification signatures are not delivery evidence.

A separate manual browser run used real local Supabase Auth, Worker HTTP APIs and D1, with the real Stripe hosted pages and official CLI 1.54.0; no payment provider substitute or browser route interception was active. Before mutation, both the runner and server checked the exact managed account and test balance. Stripe's standard test card was used; no live funds or real card were involved.

| Flow | Observed result |
|---|---|
| Hosted $4.90 credit-pack Checkout | Complete/paid; real callback confirmed the owned order and granted 50 purchased credits |
| Hosted $9.90 monthly Checkout | Paid first invoice; real callback plus bounded Scheduled recovery granted 100 subscription credits; UI total 150 |
| Test Clock renewal | Second paid invoice with `subscription_cycle`; separate next-period source of 100, not added to today's available 150 |
| Actual owned Portal cancellation | Flexible subscription stayed active, `cancel_at` equaled paid period end while `cancel_at_period_end=false`; paid sources retained |
| Actual full pack refund | Stripe `succeeded`, amount 490; only purchased source reversed, 100 current subscription credits retained |
| Test Clock reaching cancellation | Canonical subscription became `canceled`; paid invoice count remained two, no third period charged |
| Provider delivery / recovery | 17 real provider or internal recovery events finished `done`; zero pending/review; three grant ledger entries (50 + 100 + 100 future) and one source refund (-50) |

Delivery was **Stripe → official CLI listener → local Worker**, with the real listener signing secret, raw-body verification and canonical Stripe API re-fetches. Concurrent subscription/refund events actually exercised account-lock retries; the native local Scheduled handler recovered them without duplicate grants. This ten-minute recovery design can leave the return page pending beyond its 60-second polling window. Do not label it instant fulfillment. Test Clock advancement does not change application wall time: persisted future-period validity and current spendability were verified separately.

The actual Portal behavior exposed a cancellation display bug. A new regression failed on the missing timestamp, then passed after forward-only migration `0005_scheduled_cancellation.sql`, canonical timestamp persistence, classic-mode fallback, reactivation clearing and bilingual actual-date display. The fixed UI was checked against another genuine Stripe subscription update.

The opt-in `test:sandbox:browser` runner makes hosted UI/provider delivery reproducible using the operator's own Sandbox; see [instructions](../billing.md). Review also corrected startup-interrupt cleanup, owned process-group cleanup and private-file permissions. A forced listener startup failure returned nonzero and restored the original config/environment/lock. The final runner also reached actual Sandbox readiness; Ctrl+C restored default config and the prior fixture environment, removed its lock and stopped its server. The deterministic billing browser suite passed again (one test, 27.0 seconds); its supplier substitute remains separate evidence.

Hosted Supabase credentials remain deferred. This acceptance therefore does not establish authenticated cloud billing, direct Stripe-to-deployed-Cloudflare callbacks, deployed billing setup readiness or cloud CPU limits. No production payment acceptance or full Phase 3 cloud gate is claimed.
