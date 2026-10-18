# App Starter

An MIT-licensed starter for deploying a React application and API together on Cloudflare. Use your own accounts; no parent repository, Codex, MCP, or private infrastructure is required.

**Web foundation and optional billing:** Supabase Auth, administrator bootstrap/invitations, React workspace, owner-scoped D1 records, private R2 attachments, native deployment, and Stripe Checkout/Portal with a source-based entitlement ledger. The `agent` preset currently reserves a separate entry; chat, Workflows and usage settlement are Phase 4.

[中文说明](docs/README.zh-CN.md) · [Deployment](docs/deployment.md) · [Architecture](docs/architecture.md) · [Validation](docs/validation/phase-two-status.md)

[Contributing and branch policy](CONTRIBUTING.md): all changes enter `main` through a pull request; direct/force pushes and deleting `main` are blocked, including for maintainers.

Payments default to disabled. Enable `billing` in `app.config.ts`, provide your own environment's Stripe secret key, and deploy: the setup command manages Products, versioned Prices, Portal, Webhook and secret readiness. [Billing setup, semantics and recovery](docs/billing.md) · [Phase 3 validation](docs/validation/phase-three-status.md). Real managed Sandbox Checkout/Portal passed against the local application. Direct Stripe-to-Cloudflare callbacks and hosted Supabase authentication also passed; complete hosted Checkout through the cloud application remains unverified. [Cloud evidence and limits](docs/validation/cloud-payment-2026-10-18.md).

[Optional email](docs/email.md): Cloudflare aliases forward to your verified existing mailbox; Resend sends from your own verified domain and can provide Supabase custom SMTP. Configure once with `npm run email:setup -- dev`. No mail provider or domain is needed for default invite-mode startup.

## Start locally

Requirements: Node.js 24+, npm, Docker, and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started). Local D1/R2 require no Cloudflare account. Put the CLI on PATH, or set `SUPABASE_CLI` to its executable path.

```sh
npm ci
npm run auth:local:start
npm run dev
```

In another terminal:

```sh
npm run bootstrap:token -- local
```

Open the private link in `.local/bootstrap-local.txt` and create your administrator. The one-time token expires in 30 minutes and cannot initialize another administrator after completion.

Local Auth runs only the isolated `app-starter-e2e` project. The command preserves local data, saves credentials in ignored `.local/`, creates `.dev.vars` only if absent, and matches signup policy to `app.config.ts`. Changing that policy may restart this local stack. Mailpit: `http://localhost:55324`. Stop it with `npm run auth:local:stop`.

For hosted local development, fill `.dev.vars` from `.dev.vars.example` using a dedicated development Supabase project. Integration tests still use isolated local Auth.

## Configuration

```ts
// app.config.ts
const config: AppConfig = {
  slug: 'my-app',
  title: 'My App',
  preset: 'web',
  authMode: 'invite',
  maxFileBytes: 10 * 1024 * 1024,
};
```

Infrastructure bindings and secrets belong to each environment. The browser receives only a whitelist from `/api/config`. Invite mode requires no SMTP: administrators generate one-time links and share them privately. Public mode additionally requires email verification, custom SMTP and the supplied confirmation/recovery templates configured **inside Supabase**.

## Deploy

1. `npx wrangler login`; fill the target account and public variables in `wrangler.jsonc`.
2. `npm run deploy:dev -- --prepare` creates/reuses one D1 and one private R2 bucket, saving stable mappings. Commit those non-secret mappings in your derived app.
3. `npx wrangler secret put SUPABASE_SECRET_KEY --config wrangler.jsonc --env dev`.
4. `npm run deploy:dev`, then `npm run bootstrap:token -- dev`.

Use `prod` for production. Dev/prod must use separate Supabase projects, D1 databases, R2 buckets and secrets. Builds finish before remote migrations; the emitted D1 binding must match the migration target. Redeploying preserves data/credentials. [Detailed setup](docs/deployment.md).

The measured payment reconciliation path failed the Workers Free 10 ms CPU gate: all 40 samples exceeded it. Plan for Workers Paid when enabling payments; Paid performance remains untested. No script buys a plan. [Measurement scope](docs/validation/cloud-payment-2026-10-18.md) · [Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/).

## Checks

After starting local Auth:

```sh
npm run type-check
npm test
npm run test:e2e
npm run test:e2e:public
npm run test:e2e:billing
```

Tests use real local Supabase Auth/Postgres/Mailpit, Worker APIs, D1 and R2. Browser tests do not intercept backend routes. E2E resets only its isolated D1/R2 persistence. Public E2E temporarily changes the local app/Auth signup mode and restores invite mode; run it separately from dev servers and other tests.

`npm run build` emits `dist/client` and `dist/worker`. `test:build` inspects the actual import graph and bindings. Queries have a 60-second freshness window and at most one retry; writes do not retry automatically.

## Historical probes

`probes/` preserves Phase 1 experiments; product `src/` does not import them. Better Auth remains a development dependency solely for archived tests. `npm run test:probes` runs them. `npm run verify:gate` still fails for the historical Better Auth/Workers Free CPU gate; it is not Phase 2 acceptance. [Historical results](docs/validation/phase-one-summary.md).

[MIT license](LICENSE) · [Dependency notices](THIRD_PARTY_NOTICES.md)
