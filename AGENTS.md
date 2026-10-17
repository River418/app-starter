# Repository Instructions

This is an independent open-source Cloudflare application starter. Read the design and implementation plan linked in README.md before changing behavior.

## Phase gates

- Phase 1 evidence is recorded in docs/validation/phase-one-summary.md. Its Better Auth Free CPU gate failed and remains historical evidence.
- Later user instruction on 2026-10-17 explicitly resumes Phase 2 (tasks 5–7), accepts necessary platform costs, names the project app-starter, and replaces Better Auth with Supabase Auth. This supersedes the previous pause and admission gate for implementation. Payments and Agent runtime remain later phases.
- The user explicitly waived two unavailable Stripe Sandbox checks. Only the scope recorded in `docs/validation/approved-exceptions.json` may be waived; payment validation remains unverified.
- Phase 1 may add only the minimum disposable probes and their tooling.
- Measure the new authentication architecture independently; do not describe the old CPU failure as fixed without new evidence.
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
- Phase 2 product commands: `dev`, `build`, `deploy:dev`, `deploy:prod`, `auth:local:start`, `auth:local:stop`, `bootstrap:token`, `test:build`, `test:integration`, `test:e2e`, `test:e2e:public`. Full integration needs the isolated local Supabase stack; never point tests at hosted identity data. Run mode-switching browser suites sequentially.
