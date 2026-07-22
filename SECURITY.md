# Security Policy

The Cosmos is a static, client-side app with no backend — but drift-sync runs in CI with real credentials (a GitHub PAT and an Anthropic API key), so configuration mistakes can have teeth.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private vulnerability reporting on this repository (Security → Report a vulnerability). You'll get a response within a week.

## Notes for operators

- Store the drift-sync PAT and API key only as GitHub Actions **secrets**; never commit them or put them in `config.json`.
- The PAT needs only the `repo` scope. Don't grant more.
- Drift-sync is disabled on forks by default (`DRIFT_SYNC_ENABLED` repo variable) — leave it off unless you've reviewed the workflow.
