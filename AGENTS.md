# Repository Instructions

This is an independent open-source Cloudflare application starter. Read the design and implementation plan linked in README.md before changing behavior.

## Phase gates

- Phase 1 probes are in development. The application template is not implemented and Phase 2 remains locked.
- User steering on 2026-10-17: retain the existing Better Auth design and Workers Free, complete the remaining probes, and defer Phase 2. Do not start the template without a later user instruction.
- The user explicitly waived two unavailable Stripe Sandbox checks. Only the scope recorded in `docs/validation/approved-exceptions.json` may be waived; payment validation remains unverified.
- Phase 1 may add only the minimum disposable probes and their tooling.
- Do not construct the application template until the deployment, CPU/protocol, and recovery gates all have passing evidence for the selected dependency commit and platform plan.
- Treat not-run, skipped, failed, missing evidence, and local substitutes for cloud measurements as non-passing.
- Re-run affected gates when platform configuration or relevant dependencies change.

## Independence and implementation

- Do not import source, configuration, runtime resources, or secrets from the parent repository.
- Keep browser, Worker, Workflow, and shared dependencies separate as specified in the design.
- Prefer a thin composition of native Cloudflare tools; do not create a deployment framework or compatibility layer for novel-writer.
- Lock the exact versions validated by probes. Use current official documentation for SDK/provider compatibility.
- Preserve applicable third-party licenses when copying general-purpose components.

## Verification and credentials

- Use disposable Cloudflare validation resources and Stripe Sandbox/test mode. Never reset existing development or production data.
- Do not create real charges or automatically buy a platform plan.
- Never commit credentials, cookies, webhook signatures, private payloads, raw cloud logs, or unredacted evidence. Only reviewed, sanitized evidence summaries may enter docs/validation/.
- Use real application APIs and persistence for integration tests. Provider substitutes are allowed for deterministic business tests, not for proving cloud CPU, real model, or real Sandbox gates.
- Current commands: `npm test`, `npm run type-check`, `npm run verify:gate`. Keep documentation aligned with actual scripts; do not claim planned application commands already exist.
- Local Vitest must use `remoteBindings: false`; deterministic model tests must not require a Cloudflare login or invoke a remote AI binding. Cloud probes are explicit opt-in commands.
- Current commands additionally include `probe:build`, `probe:deployment`, `probe:budget-protocol`, and `probe:recovery`. Probe commands default to local; cloud mode requires `--cloud`.
