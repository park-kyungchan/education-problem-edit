# Problem Edit

Math exam restoration and problem editing. Reusable domain knowledge is in Hindsight; [AGENTS.md](AGENTS.md) is the minimal agent entry route. Live schemas and behavior are defined by `src/` and tests.

Use the Bun version in [package.json](package.json):

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
bun run check:context
bun run review help
```

The immutable local knowledge dataset and historical evidence remain available to code on demand. Portable checks do not qualify full PDF conversion or native Hancom behavior.
