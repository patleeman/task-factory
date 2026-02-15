# Contribution

Use this section for day-to-day contributor workflow.

## Guides

- [Extension + Execution Skill Customization](./extensions-and-execution-skills.md) — how repo extensions and execution hooks are discovered, scoped, validated, and secured.
- [Developer Commands Reference](./developer-commands.md) — build/dev/lint/typecheck/test/coverage workflows and workspace-scoped commands.

## Architecture references for contributors

- [System Architecture](../architecture/system-architecture.md)
- [Runtime Flows](../architecture/runtime-flows.md)
- [State Contract (canonical)](../architecture/state-contract.md)

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
