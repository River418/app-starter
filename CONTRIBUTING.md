# Contributing

## Branch policy

`main` is the integration branch. **Every change must enter `main` through a pull request**, including documentation, releases, hotfixes and automation. Direct pushes are forbidden for contributors, maintainers and administrators. Force pushes and branch deletion are also forbidden on `main`.

This repository's [active GitHub ruleset](https://github.com/River418/app-starter/rules/25324932) targets `refs/heads/main`, requiring pull requests and resolved review conversations, with no bypass actors. It does not require an approving review, so a sole maintainer can merge their own PR. No required CI check is configured until a real check exists. These settings do not replace the verification below. Changing protection to bypass a particular change is not an accepted merge workflow.

GitHub rules are repository settings; cloning, forking or generating a repository from this starter does not apply them automatically. Derived applications must configure their own active branch ruleset with the same PR, no-bypass, no-force-push and no-deletion rules.

Develop on short-lived topic branches created from the latest `main`:

| Prefix | Purpose |
|---|---|
| `feat/` | New capabilities |
| `fix/` | Bug fixes |
| `docs/` | Documentation |
| `chore/` | Tooling, dependencies and maintenance |
| `codex/` | Work performed by Codex |

Use a short descriptive suffix, such as `fix/checkout-retry`. External contributors can use a fork and open a PR against this repository's `main`; direct write access is unnecessary. No permanent `develop` branch is required.

```sh
git fetch origin
git switch -c fix/checkout-retry origin/main
# Make and verify the change, then commit it.
git push -u origin fix/checkout-retry
gh pr create --base main
```

Push further changes to the same topic branch while the PR is open. If `main` changes, resolve conflicts on that branch and verify the resulting change before merging. A closed or merged PR is not a destination for new work: create a new branch and PR from current `main`.

## Review and verification

Explain the concrete problem, resulting behavior and verification in the PR. Keep its scope focused, resolve review conversations, and disclose failed, skipped or unavailable checks. Draft PRs must be marked ready before merging. Maintainers use GitHub's PR merge operation; do not merge locally and push `main`.

For runtime changes, start the isolated local Auth stack and run the full checks:

```sh
npm ci
npm run auth:local:start
npm run type-check
npm test
```

Run the relevant browser suite when changing user flows; follow the isolation and sequential-execution instructions in [deployment](docs/deployment.md) and [billing](docs/billing.md). Stop the local stack with `npm run auth:local:stop` afterward. Documentation-only changes need link/content review and `git diff --check` rather than additional runtime tests.

Local tests do not establish cloud CPU, real provider delivery or production acceptance. Preserve the explicit evidence limits in [validation](docs/validation/phase-three-status.md). Do not commit environment files, keys, cookies, private provider payloads or raw cloud logs. Every derived application uses its own accounts and resources.
