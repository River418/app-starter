# Optional receiving and sending

These capabilities are independent and default to disabled. This repository hosts no shared mail account, relay or managed domain. A domain using Cloudflare DNS is required for forwarding an address you control; a paid hosted mailbox is not required. Without a domain, use your existing mailbox directly until you have one.

```ts
// app.config.ts — examples, replace domains before running setup
email: {
  forwarding: { domain: 'example.com', aliases: ['support', 'hello'] },
  sending: {
    domain: 'notify.example.com',
    from: 'My App <updates@notify.example.com>',
    replyTo: 'support@example.com',
  },
},
```

Cloudflare Email Routing forwards the configured aliases to `EMAIL_FORWARD_TO`, your existing verified mailbox. It does not host an inbox or provide SMTP sending. Resend verifies the sending domain and sends outbound transactional email. Prefer a separate sending subdomain and keep Resend receiving disabled, so the two services do not compete for the same MX records. Forwarding rules do not grant permission to send from that address.

Automatic forwarding setup in this version supports the Cloudflare zone apex only (for example `support@example.com`). Zone-wide readiness does not prove routing is ready for a receiving subdomain; subdomain forwarding requires separate Cloudflare onboarding and is rejected by this command. Sending subdomains remain supported.

## Setup

Use the account configured for the selected dev/prod target in `wrangler.jsonc`. Put private setup values in ignored `.dev.vars.dev` or `.dev.vars.prod`, or process environment variables:

```dotenv
CLOUDFLARE_API_TOKEN=""
EMAIL_FORWARD_TO="you@your-existing-mailbox.example"
RESEND_SETUP_API_KEY=""
RESEND_API_KEY=""
```

Cloudflare setup needs readable zones/DNS, DNS Edit, Zone Settings Write (Email Routing DNS), account Email Routing Addresses Write and zone Email Routing Rules Write. `RESEND_SETUP_API_KEY` requires full access to domain APIs. `RESEND_API_KEY` should be a separate sending-only key scoped to the verified sending domain; it is the only mail key the application Worker needs. Forward-only setup does not need either Resend key.

```sh
npm run email:setup -- dev
```

The command resolves an owned Cloudflare zone, reuses/creates the Resend domain, copies its returned TXT/MX/CNAME records with DNS proxy disabled and requests asynchronous verification. It reads the provider's current records rather than assuming a legacy MX/SPF layout. Exact existing records are reused. Conflicting records and routes are preserved and stop setup; nothing automatically deletes another provider's MX, merges SPF or retargets a forwarding rule.

For forwarding, it reuses/creates the account's destination. Cloudflare sends a verification message when a new destination is added; complete that confirmation in your own inbox and rerun. A pending destination stays pending without repeatedly creating it or sending verification. Only after verification does setup enable routing DNS and create explicit aliases. An unrelated existing alias/destination stops setup. Receiving readiness and Resend verification are separate statuses under ignored `.local/email/<env>/status.json`; a pending state is not a delivery success.

Publish the runtime key using native Wrangler:

```sh
npx wrangler secret put RESEND_API_KEY --env dev
```

Deploy as usual. The setup command intentionally runs separately: DNS/destination verification can take time and does not block a normal invite-mode application deployment. No real domain was bound in this implementation's validation.

## Supabase authentication email

Supabase Auth continues to own signup, confirmation, resend and password recovery. Configure custom SMTP **in Supabase**, using Resend's host `smtp.resend.com`, port `465`, username `resend`, your sending key and verified From address. Use the supplied `supabase/templates/` confirmation/recovery templates. The command writes private SMTP fields under `.local/email/<env>/supabase-smtp.private.json` when a runtime key is present; never commit or paste this file into logs. Apply those fields to each environment's separate Supabase project. Public signup retains the existing SMTP/email-confirmation deployment gate.

An Email Routing destination is your own mailbox, not a replacement for sending users their verification email. Supabase must deliver authentication messages to each user's actual address. Preserve the approved Supabase Auth architecture; do not copy Better Auth OTP handlers from novel-writer.

## Application transaction messages

`src/server/email/send.ts` exports `sendTransactionalEmail(env, {to, subject, text, html?, operationId})`. Call it only from an authenticated, application-owned server action after validating its business purpose. Sender/reply-to come from configuration; browser input cannot select them. No arbitrary public send API is exposed.

The helper trims configuration, bounds payloads, rejects injected email headers, uses a stable application/environment idempotency key, and throws on provider errors or missing message IDs. A returned provider ID means acceptance by Resend, not inbox delivery. Resend retains email idempotency keys for 24 hours; a business action needing longer duplicate protection must retain its own operation/outbox record. Do not retry a known completed action with a different ID.

Behavior was compared with novel-writer's Resend integration: configuration, From/To, subject, text/HTML, error propagation and external-provider substitution. There is no runtime import, credential/config dependency, copied Better Auth integration or domain dependency on novel-writer. Local Auth email tests continue to use real Supabase and Mailpit; outbound mail tests replace only the Resend HTTP supplier. Cloudflare DNS/routing tests use provider substitutes and prove conflict/reuse/pending logic, not real delivery. Live forwarding, DNS propagation, Resend sender verification and SMTP delivery require an operator's domain and remain unverified.

Official references: [Cloudflare domain routing](https://developers.cloudflare.com/email-service/get-started/route-emails/), [Routing DNS API](https://developers.cloudflare.com/api/resources/email_routing/subresources/dns/methods/create/), [destination verification](https://developers.cloudflare.com/api/resources/email_routing/subresources/addresses/methods/create/), [Resend domains](https://resend.com/docs/api-reference/domains/create-domain), [SMTP](https://resend.com/docs/send-with-smtp), [idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).
