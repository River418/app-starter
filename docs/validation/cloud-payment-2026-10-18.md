# Cloud payment verification — 2026-10-18

Date uses Asia/Shanghai; the run's UTC timestamps begin on October 17. This follow-up verifies the deployed application independently of the earlier local hosted-Stripe acceptance. [Machine-readable observations](cloud-payment-2026-10-18.json) include missing samples and deployment identity. No credentials, bearer links, customer payloads or raw cloud logs are published.

Direct Stripe-to-Cloudflare delivery, deployed billing setup, hosted authentication and authenticated Checkout/Portal API creation passed within the scopes below. **Workers Free CPU failed. Full hosted Checkout completion through the cloud UI and Workers Paid remain unverified.**

## Deployment and identity

The disposable development Worker used real remote D1/private R2, Supabase Auth and the user's dedicated managed `app-starter` Stripe Sandbox. Each Stripe mutating runner first checked the exact configured Sandbox account and `livemode=false`. No anonymous Sandbox or live transactions were used. No unrelated Supabase project or production data was reused.

A dedicated free Supabase project was created in the requested organization, with Data API disabled, invite-only signup, verified-email policy, anonymous users disabled, and the deployment's exact Site URL and `/auth/confirm` redirect. Its server secret was saved only to ignored local configuration and Worker secrets. The real product bootstrap endpoint created the administrator; a real hosted password login produced the cookies used by deployed session and billing APIs. No Worker Auth guard was bypassed. SMTP/inbox delivery was not tested.

The normal deployment script passed Auth preflight, TypeScript checks, Vite build, schema-5 migrations, native deploy, health and owned Stripe setup/readiness. The readiness challenge is synthetic; provider delivery is separately established below. Actual active version after secret publication was `5c75f588-4f32-4351-b9e5-5ceff364751a` at 100%, verified by native deployment listing. A secret publication creates a new version, so the earlier upload version is not used as the CPU identity.

Source base: `c70206e6f14a91f6888c1cc3a57b91e153a96f18`. The disposable configuration enabled USD monthly 990/100 credits and pack 490/50 credits; the repository default remains billing-disabled. Native upload reported **1,731.80 KiB raw / 337.48 KiB gzip**, startup **15 ms**. This passes the current 64 MiB uncompressed bundle / one-second startup limits; it does not establish request CPU or cold-start request performance. [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/).

## Payment evidence and its boundaries

| Check | Observed result |
|---|---|
| Hosted identity → deployed application API | Actual administrator bootstrap, hosted login, cloud session and role checks passed |
| Authenticated cloud Checkout creation | Both pack and monthly sessions created through deployed APIs; Stripe confirmed test mode, correct user metadata, amount and cloud return origin |
| Retry of each Checkout operation | Same response/session reused; unpaid orders stayed unconfirmed with zero credits |
| Authenticated cloud Portal creation | Deployed API created an actual owned Stripe Portal session |
| Natural Stripe → Cloudflare delivery | Actual test subscription's `invoice.paid` reached the owned deployed endpoint; D1 event finished `done`, exactly one +100 grant |
| Actual provider redelivery | Official `stripe events resend … --webhook-endpoint …` delivered directly to Cloudflare; no CLI listener or local forwarding; grant remained single |
| Actual full test refund and cancellation | Stripe refund succeeded for 990; source reversed to zero with exactly one -100 ledger entry; canceled subscription persisted |
| Final recovery | All 61 inbox rows `done`, zero outstanding/review; includes provider, synthetic CPU and internal recovery rows, not 61 real provider deliveries |
| Hosted cloud UI payment completion | **Not run:** Chrome's 1Password confirmation blocked password entry; documented accept/click attempts failed, user dismissal requested |

The paid subscription used an explicitly disabled operator fixture, with D1 membership/customer/order fixtures and direct Stripe API subscription creation. It had **no Supabase identity** and could not log in. This proves actual provider delivery and canonical ledger effects. The separate authenticated administrator proves cloud identity and API session creation. Combining these two scopes does not establish a complete authenticated cloud hosted purchase. Earlier hosted Checkout/Portal, renewal and cancellation through the **local** application remain separate evidence in [Phase 3 status](phase-three-status.md).

Both unused administrator Checkout sessions were expired, the operator subscription was canceled/refunded, and test data was retained for audit. No broader customer cleanup or database reset was performed. The dedicated cloud resources remain available for the pending browser acceptance.

## CPU measurements

The account Dashboard explicitly showed **Workers Free**. Native Wrangler Tail supplied actual CPU and wall time; elapsed client/network time was not substituted for CPU. Requests were correlated by exact unique `sample` query, path and deployed version. Percentiles use nearest rank over captured samples only. Durable telemetry discovery returned 403 with the existing OAuth scope; permissions were not expanded. Tail missed 44 of 140 benchmark invocations, which remain missing.

| Path / workload | HTTP requests / CPU captured / missing | CPU p50 / p95 / max (ms) | Wall p50 / p95 / max (ms) |
|---|---:|---:|---:|
| Canonical paid-invoice reconciliation, 4,128-byte body | 20 / 20 / 0 | 20 / 26 / 58 | 1186 / 1318 / 1378 |
| Same reconciliation, exact 262,144-byte body | 20 / 20 / 0 | 21 / 26 / 28 | 1183 / 1346 / 1595 |
| Setup signature challenge, 4,096-byte body | 20 / 9 / 11 | 2 / 2 / 2 | 15 / 20 / 20 |
| Setup signature challenge, exact 262,144 bytes | 20 / 9 / 11 | 3 / 5 / 5 | 21 / 23 / 23 |
| Authenticated `/api/session` | 20 / 20 / 0 | 2 / 4 / 14 | 274 / 288 / 364 |
| Authenticated `/api/billing` | 20 / 12 / 8 | 4 / 4 / 4 | 325 / 340 / 340 |
| `/api/billing/catalog` | 20 / 6 / 14 | 0 / 2 / 2 | 11 / 14 / 14 |

All 140 benchmark HTTP requests returned 200. All 40 captured canonical samples exceeded Free's 10 ms CPU budget; session also had one 14 ms sample. Their `outcome=ok` does not establish compliance: Cloudflare can allow some CPU flexibility. Signature-only challenges omit canonical reconciliation and are not representative of a paid invoice's work. Missing groups have no complete passing CPU gate. [Cloudflare CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time).

Canonical benchmark notifications were **synthetically signed** using the owned endpoint secret, with fresh event IDs and the actual paid invoice object. They forced real canonical Stripe fetches and real D1 business deduplication without extra grants. They measure the actual deployed handler, but are not claimed as natural provider deliveries. Payload padding is an artificial boundary workload. Cold-start repeatability, concurrency and sustained load were not established.

## Scheduled recovery and request boundaries

The exact product Scheduled handler was deployed with a temporary one-minute validation cadence. Ten synthetic received invoice events and ten deleting file rows were seeded; canonical Stripe reads, remote D1 and R2 delete calls were real. The object keys were absent disposable validation keys, not uploaded files. Two observed Cron invocations drained the run: CPU **99 / 33 ms**, wall **26,367 / 8,486 ms**, both `ok`. All ten invoice events ended `done`, no fixture files remained, and the grant count stayed one. Per-invocation work counts were unavailable; these are not repeated samples of an identical full batch.

The Cron CPU observations also exceed the Free 10 ms budget. The cadence was restored to the product default **`*/10 * * * *`** with native `wrangler triggers deploy`; native GET schedules confirmed only that value. Code version remained unchanged. This measures handler recovery, not the propagation time or end-user fulfillment latency of the default cadence. Waiting for scheduled recovery can exceed the return page's 60-second poll window.

Seven deployed boundaries passed: signed exact 262,144 bytes → 200; 262,145 bytes → 413; missing/invalid signature → 400; wrong live mode → 400; unauthenticated billing → 401; cross-origin Portal write → 403.

## Fixes, checks and remaining work

Actual deployment uncovered and reproduced three defects: schema-5 health still expected schema 4; remote D1 read queries used the bulk-file path instead of `--command --json`; a flattened built config was selected a second time with `CLOUDFLARE_ENV`, appending another `-dev` suffix. All were fixed and the real deployment rerun passed. The health regression failed before its fix and passed afterward. Independent review found no Important/Critical defects; the latter two CLI fixes are covered by actual deployment evidence rather than dedicated unit orchestration tests.

After the final code change, `npm run type-check` and the complete `npm test` passed: **113 tests** (16 build/setup, 36 integration, 61 historical regressions). Normal deployment also passed production build. The isolated local Auth stack and Tail process were stopped; local Auth data was backed up.

For a derived app with billing, plan for **Workers Paid** and rerun the same product flows there. Paid currently starts at $5/month, but it was neither purchased nor tested here; a pricing/limit comparison is not a passing Paid gate. [Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/).

Remaining acceptance: dismiss the browser dialog and complete hosted Checkout/Portal through the deployed app, verify renewal/cancellation there if claiming a full cloud cycle, rerun on an actually upgraded Paid account, and test hosted SMTP only when a real domain/mailbox is authorized. Production/live payments and Phase 4 Agent execution are outside this acceptance.
