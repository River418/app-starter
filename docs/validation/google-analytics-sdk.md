# Google Analytics 4 SDK integration

- Date: 2026-10-22 (Asia/Shanghai).
- Version: `codex/google-analytics`, based on `f5682ab`; this report accompanies the integration in the same PR.
- Environment: Windows, Node.js 24.21.0, npm 11.19.0, isolated local `app-starter-e2e` Supabase Auth, local Worker/D1/R2. No hosted resources or Google Analytics property were configured.

## Checks

| Command | Result and scope |
|---|---|
| `npm ci` | Passed; 0 reported vulnerabilities. |
| `npm run type-check` | Passed for client, server, scripts and the existing probe client. |
| `npm test` | Passed: 19 build tests (including 3 new analytics cases), 36 application integration tests, 23 gate tests, 7 probe helper tests and 31 local probe tests. |
| `npm run test:e2e` (first attempt) | 2 passed, 1 failed: `records-files.spec.ts` reached the 30-second test deadline while waiting for the empty list after an account switch. |
| `npm run test:e2e -- tests/e2e/records-files.spec.ts --timeout=60000` | Passed in 20.5 seconds without source or test changes; the longer deadline was not reached. |
| `npm run test:e2e` (full rerun, default deadlines) | All 3 Chromium tests passed; the records/files case completed in 19.0 seconds. Covers login, protected navigation, invitations, persistence, attachments and account switching. |
| `git diff --check` | Passed. |

The analytics cases exercise the actual client module with a minimal browser API substitute: disabled/invalid IDs and non-production environments load no SDK; a valid production ID loads one asynchronous Google tag and queues initial, next and back pageviews without duplicate renders; page/referrer query strings and fragments do not enter the command queue. The existing configuration whitelist test includes the public analytics field.

The full suite emits Vite import/chunk warnings, Stripe missing-sourcemap warnings and local probe binding warnings. Recovery probes also emit their intentional deterministic provider-failure diagnostics; the test process exits successfully. These logs do not establish any cloud or Google delivery result.

The first browser failure showed the new account's workspace with its records list still loading, rather than records from the prior account. Neither the focused rerun nor the full rerun reproduced it; its cause remains unconfirmed. The browser checks run with analytics disabled (`APP_ENV=e2e`), and do not exercise Google's SDK. No timeout or authentication/query implementation was changed.

## Limits and activation

The default Measurement ID remains empty. To activate, supply the application's own `analytics.googleAnalyticsId` in `app.config.ts` and deploy with `APP_ENV=prod`. Disable the data stream's Enhanced measurement and avoid adding a second Google tag/GTM pageview tracker. Applications requiring consent must connect their consent flow before enabling this integration.

No real Google tag response, GA4 ingestion/Realtime report, production deployment, consent interface or real payment/email delivery was verified. Public-signup, billing-browser and real Stripe Sandbox suites were not run for this change. Local SDK command tests do not prove delivery to Google or browser behavior of Google's remote SDK.
