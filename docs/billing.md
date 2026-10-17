# Payments and entitlements

Billing is optional and disabled by default. Each derived app uses its own Stripe account, Cloudflare resources and Supabase identity project. There is no hosted app-starter payment service or shared merchant account.

## Configure and deploy

Add this **example**, using your own pricing and benefits, to `app.config.ts`:

```ts
billing: {
  enabled: true,
  currency: 'usd',
  monthly: { amountMinor: 990, credits: 1000, features: ['export'] },
  creditPack: { amountMinor: 490, credits: 500 },
  freeCredits: 10,
  taxBehavior: 'exclusive',
  automaticTax: false,
},
```

Amounts are integers in Stripe's currency minor units. One currency, quantity one, monthly subscriptions and one-time credit packs are supported. Each plan is optional. Feature keys are application-defined server permission names. Free credits/features are granted once per member; changing defaults does not reset an existing member's allocation. The example is not a pricing recommendation.

Put `STRIPE_SECRET_KEY` into ignored `.dev.vars.dev` for dev, `.dev.vars.prod` for prod, or an environment variable in CI. Dev accepts test mode, prod accepts live mode. Keep accounts/sandboxes and D1 resources isolated. Never use `VITE_*` or commit keys. `STRIPE_WEBHOOK_SECRET` is optional on first setup; the tool creates and backs up the endpoint's response-only secret. Restore this field from Stripe Dashboard if the backup was lost.

Deploy normally with `npm run deploy:dev` / `npm run deploy:prod`. After deploying code and forward-only migrations, the command runs billing setup automatically. For an already deployed target, rerun `npm run billing:setup -- dev` or `prod`.

Setup identifies the authenticated Stripe account and mode, verifies owned objects, creates/reuses app-scoped Products, immutable versioned Prices, an explicit Portal configuration and one snapshot Webhook endpoint pinned to SDK API `2026-09-30.endive`. It saves mappings in D1, publishes server-only Stripe secrets with native Wrangler, sends a signed setup challenge to the active Worker, and only then opens Checkout. The challenge grants nothing and does not prove Stripe Sandbox delivery. No setup command creates a charge, changes another app's objects, cancels subscriptions, rotates a signing secret, buys a plan, or modifies the account's default Portal configuration.

Price or benefit changes create a new immutable price/version. Historical mappings and existing subscriptions retain their paid contracts; there is no automatic subscriber migration or proration. The Portal supports invoice history, payment method updates and period-end cancellation. Price/quantity changes are disabled. Discounts, mixed/proration invoices, manual/out-of-band invoice payments and ambiguous payment allocations require review rather than an automatic full monthly grant.

Stripe Tax is optional. Enabling `automaticTax` requires your own Stripe Tax registrations and account setup. This starter does not calculate global taxes. Inclusive/exclusive presentation is explicit and Checkout shows the final total.

## Recovery and secret ownership

Private setup journals, operation keys, the signing-secret backup and temporary Wrangler input live under ignored `.local/billing/<env>/`. Back these up securely per deployment. Remote D1 contains only a signing-secret fingerprint, not the signing secret itself. SDK/provider errors are withheld from logs to avoid credential or payload disclosure.

Stable Product IDs and version-specific Price lookup keys recover lost create responses beyond Stripe's idempotency retention. Portal metadata recovers a lost Portal response. Webhook creation persists its exact request and idempotency key before calling Stripe; a retry can replay the response while the key is retained. After that window, a lost signing secret must be restored from Stripe Dashboard. Restore `endpointId` in the private journal and `STRIPE_WEBHOOK_SECRET` if a lost endpoint response cannot be replayed. Setup refuses automatic endpoint deletion/recreation or adoption of an unrelated URL match. A changed endpoint URL or API version requires operator repair.

Initial Stripe setup needs network access, a deployed HTTPS Worker, and a key permitted to manage the listed Stripe resources and retrieve account/balance identity. Subsequent CI setup needs its own secure signing-secret backup or `STRIPE_WEBHOOK_SECRET`. When mappings, keys or the deployed configuration disagree, new Checkout fails closed. Missing a provider credential does not silently enable free access. Disabling new purchases does not discard already accepted payment events.

## Runtime and extension points

The browser sends only `{ planKey, operationId }`. The server chooses customer, price, quantity, currency, metadata and return URLs. Persist the operation ID when retrying a failed Checkout request. Reusing it with different parameters is a conflict. Pending subscription Checkout is reused; current owned subscriptions go to the Portal instead of creating another subscription. A very old interrupted Checkout is recovered from provider history; if it cannot be identified safely it requires reconciliation.

The sole cross-origin write exemption is `POST /api/billing/webhook`. It preserves the raw body and verifies Stripe's signature with the SDK's default timestamp tolerance. Other writes keep the existing Origin and Supabase/D1 membership checks. Webhooks enter a durable D1 inbox before processing. Event leases and per-member billing leases fence every business mutation; ledger, source/order/subscription updates and event completion commit in one D1 batch. Provider failures retain retries; crashes leave reclaimable leases. Event IDs deduplicate deliveries; purchase-order and invoice IDs independently deduplicate grants.

Business data remains in D1; Supabase is identity-only. Server helpers:

- `getEntitlements(env, userId)` returns balances and features; `requireFeature(env, userId, key)` guards a feature after authenticating the request.
- `grantPurchase(env, orderId)` and `grantInvoice(env, invoiceId)` use the same canonical provider-validation pipeline. They do not trust caller-supplied amounts or benefits. Inspect the durable event state for pending/review outcomes.
- `reverseGrant(env, sourceKey, operationId, verifiedAdminIdentity, reason)` revokes that source with an audit. HTTP users must use the protected admin route, never supply their own identity.

Paid one-time credits persist independently. Monthly credits require a paid invoice and verified underlying payment, use the billed historical Price snapshot, expire at that invoice line's period end, and never roll over. Period-end cancellation preserves paid benefits until expiry. Renewal failure grants no new period and no grace. The return page polls only its owner's order for at most 60 seconds; timeout stays pending, and only server-confirmed benefits trigger account-query invalidation.

A confirmed full refund reverses that source's unused credits and features. It does not take another pack's credits or create hidden account debt. A consumed refund is marked for review. Partial refunds suspend the source for explicit review. Disputes suspend only their source; won/closed warnings restore eligible benefits, lost disputes revoke the unused source. Canonical payment checks prevent a delayed success event from recreating refunded benefits. Multiple-source payment ambiguity is held for review.

The authenticated administrator page supports owner filtering, recent orders/subscriptions, pending/review events, idempotent retry/reconciliation and source adjustments/revocation. Every mutation requires an operation ID and reason and writes an audit. Credit adjustments cannot make a balance negative. Review resolution is explicit and can restore the reviewed source; revocation removes its benefits. Refund initiation stays in Stripe Dashboard. The page is intentionally a bounded operational view, not an accounting export.

The single ten-minute Scheduled handler shares a maximum of 20 inspected candidates: ten file-cleanup candidates and ten payment retry/reconciliation candidates. Recovery is eventual and bounded, not an instant replacement for Webhook delivery. Monitor pending/review events in administration. Heavy processing/large traffic can require Workers Paid; no Free CPU guarantee is inferred from local tests.

Usage reservations, logical-step settlement, Agent runs and model cost accounting belong to Phase 4. A future successful-step debit must share a D1 batch with the persisted step result and run/cancellation version checks. Do not charge users via a separate post-result decrement.

## Verification

```sh
npm run auth:local:start
npm run type-check
npm test
npm run test:e2e
npm run test:e2e:billing
```

The billing browser runner temporarily enables an example credit pack, starts a loopback-only external payment substitute, and restores the default config. Do not run it concurrently with dev servers, public-mode E2E or other config-changing tests. The substitute is clearly labeled, requests no card details and makes no charge. The actual browser, Supabase session, Worker API, signature verification, migrations, D1 ledger and refund path remain real; no browser route mocks are used. `STRIPE_TEST_API_URL` is forbidden outside local/test/e2e with a loopback application and test key.

Real Stripe Sandbox account isolation, actual Checkout/Portal, billing-cycle renewal/cancellation/refund and provider-to-cloud delivery remain unverified until you run them with your own test credentials. Local substitutes and a signed setup probe do not pass those gates. See [Phase 3 validation](validation/phase-three-status.md).

For an isolated full-access Sandbox, add its test key and non-secret `STRIPE_SANDBOX_ACCOUNT_ID` to ignored `.dev.vars.dev`, keep local Auth running, then run `npm run test:sandbox`. The opt-in suite checks the exact account and test mode before any write. It uses real Stripe catalog/Checkout/Portal APIs, a real paid subscription invoice, cancellation and refund through the application/D1 logic. It creates only Sandbox transactions and cancels its subscription/unfinished Checkout. Synthetic signed notifications in this suite do not prove actual Webhook delivery or completion of Stripe-hosted Checkout; those need a separate CLI-forwarding/browser/cloud smoke. Anonymous unclaimed CLI Sandbox keys can lack account/balance permissions and therefore correctly fail initialization instead of bypassing readiness.

Existing mapped customers can still use the Portal after new purchases are disabled. Scheduled recovery also revisits active paid sources to discover missed refund/dispute callbacks. Explicitly resolved review fingerprints survive duplicate notices; a new refund amount or dispute outcome triggers a new review/reversal.

Official references: [Webhook delivery and signatures](https://docs.stripe.com/webhooks), [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment), [subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks), [Price management](https://docs.stripe.com/products-prices/manage-prices), [idempotency](https://docs.stripe.com/api/idempotent_requests).
