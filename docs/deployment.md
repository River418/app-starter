# Deployment and authentication

## Environments

| Environment | Runtime and business data | Identity |
|---|---|---|
| local | Vite/local Worker, local D1/private R2 | isolated local Supabase or dedicated hosted dev project |
| dev | development Worker, D1/private R2 | dedicated hosted dev Supabase project |
| prod | production Worker, D1/private R2 | separate hosted production Supabase project |

Application data stays in D1. Supabase owns Auth; no application tables/RLS policies are needed there. Never reuse an unrelated Supabase project for validation.

## Supabase settings

For each project, enable email/password and email confirmation; disable anonymous sign-ins. Invite mode disables public signups while leaving the email provider enabled. Admin `generateLink(type: invite)` still works without SMTP. Public mode enables signups and requires custom SMTP plus `supabase/templates/confirmation.html` and `recovery.html` configured in Supabase.

Set Site URL to that environment's HTTPS `APP_ORIGIN`; allow its `/auth/confirm` redirect. A separate local-dev project can allow `http://localhost:5173/auth/confirm`. Email templates must pass `TokenHash` to the app confirmation page with `type=email` or `type=recovery`. Do not use default implicit-fragment confirmation URLs with this server cookie flow.

Copy the project URL, publishable key and secret key. Only URL/publishable key may be public. Legacy anon/service-role keys remain compatible with the local CLI. Default hosted SMTP is restricted; public mode needs a real verification/recovery email smoke with your controlled mailbox. Do not paste keys into issues/chats/logs.

## Cloudflare

Fill each selected `env.dev` / `env.prod` in `wrangler.jsonc`:

```json
{
  "account_id": "YOUR_CLOUDFLARE_ACCOUNT_ID",
  "vars": {
    "APP_ENV": "dev",
    "APP_ORIGIN": "https://my-app-dev.YOUR_SUBDOMAIN.workers.dev",
    "SUPABASE_URL": "https://YOUR_DEV_PROJECT.supabase.co",
    "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_...",
    "AUTH_SETTINGS_CONFIRMED": "invite"
  }
}
```

Use `AUTH_SETTINGS_CONFIRMED: public` only after SMTP/templates are configured. Deployment also reads actual Auth settings and rejects the wrong signup mode, automatic email confirmation or anonymous users. That endpoint cannot prove SMTP delivery.

Choose the slug before preparation; Worker names are derived as `${slug}-dev` / `${slug}-prod` on first preparation. Existing names and resource mappings are preserved on later runs. `npm run deploy:dev -- --prepare` saves resource mappings and recovers interrupted creation by stable names. Preparation never makes R2 public, resets data or rotates secrets. Changing a title does not recreate resources.

```sh
npx wrangler secret put SUPABASE_SECRET_KEY --config wrangler.jsonc --env dev
npm run deploy:dev
npm run bootstrap:token -- dev
```

Native Wrangler may create a draft Worker when setting the first secret. The script selects `CLOUDFLARE_ENV` before building, then migrates/deploys with the emitted `dist/worker/wrangler.json`. Never add a different `--env` to that built config. Secret listing verifies existence; real login verifies the credential itself.

Forward-only migrations run only after successful types/build and a matching built D1 ID. Startup checks schema version without migrating. Do not edit applied migrations in a derived app. There is no destructive schema rollback. Workers Paid is a separate account subscription; these scripts never purchase it. Supabase Auth does not guarantee the remaining Worker CPU fits Free.

## Administrator and links

`bootstrap:token -- local|dev|prod` writes a private one-time link, valid for 30 minutes. Bootstrap reserves a D1 user UUID before Supabase creation and reconciles only that UUID after a lost response. It never promotes an arbitrary existing email. An email collision stays claimed for operator inspection; do not reset initialization to promote another account. Bootstrap before exposing public registration.

Admin invite/recovery operations require an operation ID and reason, and write audit records. Retrying the same ID does not re-display the bearer; reissue with a new operation. D1 keeps only SHA-256 of the Supabase token hash. Pending invitations cannot access business APIs before app-controlled password setup. GET/email prefetch does not redeem links; a human clicks Confirm.

Revocation only cancels a pending invitation through a conditional D1 state change. Recovery links cannot be revoked by this application: issue a replacement to rotate the provider token, or manage already-issued sessions in Supabase. A bound verified session can resume password setup after refresh; an administrator can issue recovery for a pending invitee who lost that session. Supabase and D1 changes are not one distributed atomic transaction.

Supabase native cookies are browser-readable, host-only, SameSite=Lax and Secure over HTTPS. The server creates a request-scoped client, calls `getUser()`, requires verified email, and checks D1 membership/role. Editable metadata never authorizes requests. Writes require exact configured Origin. Subject changes clear Query/UI state and hide the old workspace until loaders validate the new identity.

## Local verification

The isolated project is `app-starter-e2e`: API 55321, DB 55322, Mailpit 55324. `SUPABASE_CLI` overrides the CLI executable. Credentials/logs remain ignored. Stop without `--no-backup` to retain local data; do not use `--all` or reset a hosted database.

E2E resets only `.local/e2e-workers`, creates/deletes only prefixed users in local Auth, and refuses non-loopback endpoints. Normal local app data in `.wrangler/state` is separate. Public E2E temporarily changes signup policy and restores it in `finally`; run test suites sequentially.
