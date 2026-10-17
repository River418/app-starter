# Repository Instructions

This is an independent open-source Cloudflare application starter. Read the design and implementation plan linked in README.md before changing behavior.

## Phase gates

- The current repository contains planning documents, not a working starter.
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
- This documentation-only baseline has no dependency install, build, or runtime test commands. Do not claim proposed commands already exist.
