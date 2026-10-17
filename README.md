# Cloudflare App Starter

An independent, open-source starter for validating web and agent applications with a small amount of configuration on Cloudflare.

**Status: Phase 1 evidence collected; Phase 2 deferred by the user.** The application template has not been implemented. Deployment, real model/browser protocol, and recovery probes passed their recorded scope. Workers Free failed the default Better Auth password CPU budget, so the combined admission gate remains closed. [Validation results](docs/validation/phase-one-summary.md).

## Design

The proposed stack is React, Vite, Hono, Better Auth, D1, Drizzle, R2, Stripe, AI SDK, Workers AI, and Workflows. The web and agent presets share one application and deployment flow. Infrastructure starts with free allowances where practical; complete applications may require Workers Paid. Model, payment, email, and excess resource costs are separate.

Frontend defaults include shadcn/ui with Radix, Tailwind CSS, React Router, TanStack Query, React Hook Form, Zod, optional Zustand, react-i18next, and assistant-ui for the agent preset.

## Documents

- [Complete design](docs/superpowers/specs/2026-10-17-minimal-cloudflare-app-starter-design.md)
- [Implementation plan](docs/superpowers/plans/2026-10-17-cloudflare-app-starter-implementation-plan.md)

The documents are currently written in Chinese. Probe tooling is available; application and deployment commands in the plan are still deliverables to be implemented.

```sh
npm ci
npm test
npm run type-check
npm run probe:build
npm run probe:deployment -- --local
npm run probe:budget-protocol -- --local
npm run probe:recovery -- --local
npm run verify:gate
```

The tests use disposable local Workers, D1, R2, and Workflows, with deterministic model adapters and remote bindings disabled. They require no Cloudflare credentials and do not establish cloud readiness. `verify:gate` intentionally fails while any required real-cloud gate fails or lacks evidence. [Running the explicit cloud probes](docs/validation/running-probes.md).

The user waived unavailable Stripe Sandbox synchronization/price checks. This is a named exception, not a payment pass. The current probes verify raw-body HMAC signatures, event deduplication, and refusal when a signing secret is unavailable; they do not prove a real Stripe integration.

## First milestone

1. Verify isolated initial and repeated deployments without recreating resources or rotating credentials.
2. Measure real Cloudflare CPU usage and validate the exact model, AI SDK, provider, and assistant-ui combination.
3. Verify durable task recovery, duplicate delivery, cancellation races, and usage settlement.

All three gates require recorded evidence. An unexecuted, skipped, or mocked cloud check does not pass.

## Repository independence

This repository is independently clonable and will own its source, dependency lockfile, tests, releases, and documentation. Its initial development is tracked as a submodule of novel-writer, but the application must not import or require that parent repository.

## License

[MIT](LICENSE). Preserve the notices and licenses of any third-party source reused during implementation.
