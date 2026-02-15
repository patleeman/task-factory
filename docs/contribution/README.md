# Contribution

Use this section for day-to-day contributor workflow.

## Guides

- [Developer Commands Reference](./developer-commands.md) — build/dev/lint/typecheck/test/coverage workflows and workspace-scoped commands.

## Quality baseline

Before opening a PR, run:

```bash
npm run lint
npm run typecheck
npm run test
```

For release-sensitive work, also run:

```bash
npm run check:release
```
