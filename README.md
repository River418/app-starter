# App Starter

[中文](docs/README.zh-CN.md) · English

App Starter is an MIT-licensed full-stack template for building applications on Cloudflare. It brings together a React workspace, authentication, administrator tools, application data, private attachments, optional payments and email, so you can start with your product's features instead of assembling that foundation for every new application.

Use it for account-based tools, subscription products and internal workspaces. A sample records feature demonstrates the path from a validated form to an authorized API, persistent data and file attachments. Replace or extend that feature to build your own application. You own the source code, provider accounts and deployment resources; no shared App Starter service is required.

## Capabilities

| Area | Included capabilities |
|---|---|
| Accounts and access | Supabase email/password login, invite-only or public signup, email confirmation, password recovery, and server-side membership/administrator checks |
| Administration | One-time first-administrator setup, a user directory with roles/statuses, invitations and recovery links, invitation revocation, and administrative audit records |
| Application UI | Responsive workspace, protected routes, Chinese/English translations, light/dark themes, reusable form/dialog components and notifications |
| Application data | D1-backed records with create/edit/delete, title search, pagination and per-user ownership; shared Zod contracts for forms and APIs |
| Private files | Record attachments in private R2 storage, authenticated downloads, configurable upload size limits and scheduled cleanup |
| Payments | Optional Stripe monthly subscriptions and one-time credit packs, hosted Checkout, customer Portal, invoice access and period-end cancellation |
| Entitlements | Separate free, subscription-period and purchased credit sources, feature permissions, duplicate-grant prevention, source-specific refund/dispute handling and administrator recovery |
| Email | Optional Cloudflare address forwarding to an existing mailbox, Resend transactional sending and configuration guidance for Supabase custom SMTP |
| Deployment | Frontend assets and API on one origin, native Vite/Wrangler tooling, separate local/dev/prod resources and forward-only D1 migrations |

Invite mode is the default and does not require a mail provider. Public signup requires verified-email delivery through Supabase. Payments and email are optional and disabled unless configured.

## Technology and runtime

| Layer | Technology |
|---|---|
| Browser | React, TypeScript, Vite, React Router, TanStack Query |
| Forms and UI | React Hook Form, Zod, Radix primitives, Tailwind CSS, Lucide, Sonner, i18next |
| API | Hono on Cloudflare Workers |
| Identity | Supabase Auth |
| Application database | Cloudflare D1, Drizzle ORM and explicit SQL for coordinated writes |
| File storage | Private Cloudflare R2 |
| Optional integrations | Stripe, Cloudflare Email Routing and Resend |

Vite builds static browser assets and a separate Worker. Supabase owns identity; application memberships, records, file metadata, orders and entitlement ledgers live in D1. R2 stores file contents. Feature code is organized into `client`, `shared` and `server` directories so browser bundles cannot import server implementations or secrets.

## Start locally

Install Node.js 24+, npm, Docker and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started). Start Docker and put the CLI on `PATH`, or set `SUPABASE_CLI` to its executable path. Local D1/R2 do not need a Cloudflare account.

```sh
npm ci
npm run auth:local:start
npm run dev
```

Open `http://localhost:5173`. In another terminal, generate the first-administrator link:

```sh
npm run bootstrap:token -- local
```

Open the private link saved in `.local/bootstrap-local.txt` to create the administrator. It expires after 30 minutes and is only for initializing the first administrator. You can then manage users and share invitation links from the application.

Local Auth uses the isolated `app-starter-e2e` project. The startup command saves local credentials under ignored `.local/`, creates `.dev.vars` if absent and preserves an existing file. Mailpit is available at `http://localhost:55324`. Stop the stack with `npm run auth:local:stop`; local data is retained.

You can also use a dedicated hosted development Supabase project by filling `.dev.vars` from `.dev.vars.example`. Integration tests still use isolated local Auth. See [development and authentication setup](docs/deployment.md).

## Configure your application

Set public application choices in `app.config.ts`:

```ts
import type { AppConfig } from './src/shared/config';

const config: AppConfig = {
  slug: 'my-app',
  title: 'My App',
  preset: 'web',
  authMode: 'invite',
  maxFileBytes: 10 * 1024 * 1024,
};
export default config;
```

| Configuration | Where it belongs |
|---|---|
| Name, signup mode, upload limit, optional billing/email settings | `app.config.ts` |
| Target account, public Auth settings and D1/R2 resource mappings | The selected environment in `wrangler.jsonc` |
| Local runtime credentials | Ignored `.dev.vars` |
| Dev/prod setup credentials | Ignored `.dev.vars.dev` / `.dev.vars.prod`, or CI environment variables |
| Deployed server secrets | Cloudflare Worker secrets |

The browser receives only the public configuration whitelist from `/api/config`. Keep secret keys out of `app.config.ts`, `VITE_*` variables and source control.

Enable billing by adding a `billing` configuration with your currency, pricing and benefits, then providing that environment's Stripe key. Normal deployment synchronizes owned Products, immutable Prices, Portal and Webhook configuration, publishes server-only secrets and checks readiness before opening Checkout. See [payments and entitlements](docs/billing.md).

For email, configure forwarding and/or sending, then run `npm run email:setup -- dev`. Forwarding requires a domain on Cloudflare and your existing verified destination mailbox; it does not host a mailbox. Resend sending requires a verified domain. Public signup's SMTP and email templates are configured inside Supabase. See [email setup](docs/email.md).

## Deploy

Create a dedicated hosted Supabase project for the target environment. Configure email/password, verified-email policy, signup mode, Site URL and the `/auth/confirm` redirect, then fill that environment's account and public settings in `wrangler.jsonc`.

```sh
npx wrangler login
npm run deploy:dev -- --prepare
npx wrangler secret put SUPABASE_SECRET_KEY --config wrangler.jsonc --env dev
npm run deploy:dev
npm run bootstrap:token -- dev
```

Preparation creates or reuses one D1 database and one private R2 bucket, then saves their mappings. Commit those non-secret mappings in your derived application. Deployment checks configuration, builds the application, applies forward-only migrations and checks health.

Use `prod` for production. Dev/prod must use separate Supabase projects, D1 databases, R2 buckets and secrets. Provider quotas and charges apply independently; assess Worker CPU limits and plan for Workers Paid when enabling billing. Deployment commands do not purchase plans. See [deployment instructions](docs/deployment.md) and [Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/).

## Development and checks

Start local Auth before running integration or browser tests:

| Command | Purpose |
|---|---|
| `npm run dev` | Local frontend and Worker development |
| `npm run build` | Emit `dist/client` and `dist/worker` |
| `npm run type-check` | TypeScript checks |
| `npm test` | Build/setup, application integration and probe regression suites |
| `npm run test:e2e` | Workspace, authentication, records and attachments browser tests |
| `npm run test:e2e:public` | Public signup and recovery browser tests |
| `npm run test:e2e:billing` | Billing browser tests with a deterministic external payment substitute |

Application tests exercise real local Auth, Worker APIs and persistence. Run the browser suites sequentially: public/billing runners temporarily change their own configuration and restore it afterward. Real-provider acceptance uses separate opt-in commands documented in [billing](docs/billing.md).

## Project layout

```text
app.config.ts        Application choices
src/client/          React shell, routing, UI and client utilities
src/features/        Business features split into client/shared/server
src/server/          API, Auth, administration, database, files and email
src/shared/          Runtime-neutral configuration and contracts
scripts/             Development, deployment and provider setup tools
migrations/          Forward-only D1 migrations
locales/             English and Chinese translations
supabase/            Local Auth configuration and email templates
tests/               Build, integration, browser and provider tests
docs/                Deployment and integration guides
probes/              Isolated experiments and regression fixtures
```

For architecture, code boundaries and change-specific verification, see [AGENTS.md](AGENTS.md). Contributions use topic branches and pull requests; direct pushes to `main` are prohibited. Forks and derived repositories must configure their own GitHub protection. See [CONTRIBUTING.md](CONTRIBUTING.md).

[MIT license](LICENSE) · [Dependency notices](THIRD_PARTY_NOTICES.md)
