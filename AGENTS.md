# AGENTS.md

## Durable repository facts

- Use pnpm only. Do not add npm fallback commands or lockfiles.
- Use GitHub Issues for work tracking when a ticket is useful. See
  `docs/agents/issue-tracker.md`.
- Use the triage labels in `docs/agents/triage-labels.md`.
- This is a single-context repo. Read `CONTEXT.md` and relevant files in
  `docs/adr/` before changing architecture or public contracts.
- This is a Vite, React, TypeScript, Three.js web app. Keep durable simulation
  logic testable outside React and Three.js.
- For visuals, verify a live page with browser tooling before handoff whenever
  rendering, animation, or layout changed.
- Do not commit `node_modules`, `dist`, coverage, Playwright reports, test
  output, local review logs, exported videos, or AppleDouble `._*` sidecars.

## Agent skills

### Issue tracker

Issues and PRDs live in GitHub Issues for this repo; external pull requests are
reviewed as pull requests, not triaged as requests. See
`docs/agents/issue-tracker.md`.

### Triage labels

Use these GitHub triage labels: `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, and `wontfix`. See
`docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context layout: root `CONTEXT.md` plus product ADRs in
`docs/adr/`. See `docs/agents/domain.md`.

## Default validation ladder

Use the narrowest validation that proves the change, then widen before commit:

```bash
pnpm run lint
pnpm run test
pnpm run build
```

Add focused `pnpm run e2e` when the touched surface warrants browser coverage.
