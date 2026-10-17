# Phase 2 validation

Approved scope: tasks 5–7, public **app-starter**, Supabase Auth replacing product Better Auth. Necessary costs no longer block implementation. The user deferred hosted Supabase credentials; complete cloud authentication/email delivery remain unverified.

- Local integration uses real Supabase Auth/Postgres, Workers, D1 and R2. Browser flows use real APIs/cookies and Mailpit messages, with no backend route interception.
- Cloudflare smoke uses separate disposable dev/prod resources with Auth explicitly unconfigured. It proves only its recorded deployment/routing/isolation/retention scope, not cloud login, authenticated CRUD, email delivery or the new auth CPU budget.
- Historical Phase 1 Better Auth/Free CPU failure remains failed.
- Payments, Agent execution and release packaging remain phases 3–5.

## Final verification

Source implementation: `be9af0616541d23bc70fb4aa2c4a961817fae52d`. [Sanitized machine-readable results](2026-10-17-phase-two-results.json).

| Check | Result |
|---|---|
| Worker/client type checks | passed |
| Full npm test | 82 passed: 8 build, 13 application integration, 61 historical regression |
| Invite/workspace browser suite | 3 passed |
| Public email/recovery browser suite | 1 passed |
| Isolated native migration/bootstrap CLI | passed; duplicate token issuance refused without rotation |
| Fresh whole-branch review | 3 important findings fixed and covered by regression; deletion coverage gap fixed |

Browser checks include refreshing between confirmation and password setup, actual record update/delete with attachments, cross-account data clearing, language/theme/mobile navigation, real verification/recovery emails and token replay rejection. Tests used real local GoTrue/Postgres/Kong/Mailpit and application storage, with no browser backend interception. Public-mode testing restored invite policy afterward. Local Auth containers were stopped with data backups retained.

## Cloudflare smoke

The initial snapshot completed first and repeated deployment in each environment, with 24 HTTP assertions and retained D1 infrastructure sentinels. The final source was then deployed again to both existing environments, with 6 HTTP and 6 no-referrer header assertions per environment. The root agent independently rechecked final health/config/API 404/SPA responses.

- [Development smoke](https://app-starter-check-418-20261017-dev.broadvisionx.workers.dev): native version `57e359fb-2995-4d25-83c2-c33ad563a1bb`.
- [Production smoke](https://app-starter-check-418-20261017-prod.broadvisionx.workers.dev): native version `3472e46f-5f0f-472d-8d3d-bd1246a9357e`.
- Final 45-file source manifest SHA-256: `dbf376509255e415dfa96619fbaae9cacf9883f04531b1386e3c8c8abfe7b587`.
- Both serve `authMode=invite`, `authReady=false`, schema version 2. Unconfigured session requests return 503; no substitute credentials bypass the production deployment guard.

These validation resources remain available without Cron triggers. Their private D1/R2 and Worker identities were reused. A direct D1 sentinel is an infrastructure fixture; it does not prove authenticated cloud CRUD. No CPU samples were collected for the final snapshot. Earlier anonymous samples cannot establish the new authentication budget. Hosted Supabase login and SMTP remain deferred as agreed.
