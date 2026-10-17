# Phase 2 amendment approved by the user

The project and public repository are named **app-starter**. The user resumed tasks 5–7 regardless of whether a paid platform is needed. The previous Phase 1 gate does not prevent implementation; its failed Better Auth CPU evidence remains unchanged.

Supabase Auth replaces Better Auth in the product. Supabase owns passwords, registration, email verification and recovery. D1 owns application membership, roles, audit, bootstrap, invitations, records and file journals. R2 remains private. No Supabase application tables or service-role credentials are exposed to browsers. Server authorization uses a fresh `getUser()` and a D1 membership check, never editable user metadata. Native Supabase browser/SSR cookies are browser-readable; same-origin checks protect application writes.

Default invite mode requires no SMTP: administrators generate one-time Supabase links and share them manually. Pending memberships cannot access application APIs until the app confirms the link and password setup. Public mode additionally requires Supabase signups, email confirmation, custom SMTP and application confirmation/recovery templates. Each environment uses its own Supabase project. Deploy preflight checks the operator's explicit confirmation of these external settings; cloud email delivery still needs a separate smoke test.

Build and deployment remain a thin composition of Vite, Cloudflare's plugin and Wrangler. No parent repository, private account, MCP or Codex is required. The existing directory may retain its original name on Windows; repository identity and application slug do not depend on checkout directory names.

This amendment takes precedence over Better Auth/Resend statements in the original design and tasks 5–7. Phase 3 payments, Phase 4 agent execution and Phase 5 release packaging are not completed by Phase 2.
