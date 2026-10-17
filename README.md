# Cloudflare App Starter

An independent, open-source starter for validating web and agent applications with a small amount of configuration on Cloudflare.

**Status: planning and repository setup.** The application template has not been implemented. Deployment, runtime budget, and recovery probes must pass before template construction starts.

## Design

The proposed stack is React, Vite, Hono, Better Auth, D1, Drizzle, R2, Stripe, AI SDK, Workers AI, and Workflows. The web and agent presets share one application and deployment flow. Infrastructure starts with free allowances where practical; complete applications may require Workers Paid. Model, payment, email, and excess resource costs are separate.

Frontend defaults include shadcn/ui with Radix, Tailwind CSS, React Router, TanStack Query, React Hook Form, Zod, optional Zustand, react-i18next, and assistant-ui for the agent preset.

## Documents

- [Complete design](docs/superpowers/specs/2026-10-17-minimal-cloudflare-app-starter-design.md)
- [Implementation plan](docs/superpowers/plans/2026-10-17-cloudflare-app-starter-implementation-plan.md)

The documents are currently written in Chinese. There are no working application or deployment commands yet; commands in the plan describe deliverables to be implemented.

## First milestone

1. Verify isolated initial and repeated deployments without recreating resources or rotating credentials.
2. Measure real Cloudflare CPU usage and validate the exact model, AI SDK, provider, and assistant-ui combination.
3. Verify durable task recovery, duplicate delivery, cancellation races, and usage settlement.

All three gates require recorded evidence. An unexecuted, skipped, or mocked cloud check does not pass.

## Repository independence

This repository is independently clonable and will own its source, dependency lockfile, tests, releases, and documentation. Its initial development is tracked as a submodule of novel-writer, but the application must not import or require that parent repository.

## License

[MIT](LICENSE). Preserve the notices and licenses of any third-party source reused during implementation.
