# Problem Edit

Math exam restoration and problem editing. Reusable domain knowledge is in Hindsight; [AGENTS.md](AGENTS.md) is the minimal agent entry route. Live schemas and behavior are defined by `src/` and tests.

Use the Bun version in [package.json](package.json):

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
bun run check:context
bun run review help
bun run production help
```

`production audit` returns applicable equation-review routes and source crop pins. `production measure` prepares finalized scripts for the qualified metric helper, which can reuse exact, byte-verified measurements. `production compose` requires the explicitly selected Python environment with [native-production requirements](packages/native-production/requirements.txt) and writes a new version directory containing editable HWPX, table/equation bindings, measured layout and structural checks. `production inspect` independently reopens that bundle against pinned raw source records and returns compact coverage counts. Use `production help` for flags and contracts; source/render verification and human review remain separate release requirements.

The immutable local knowledge dataset and historical evidence remain available to code on demand. Portable checks do not qualify full PDF conversion or native Hancom behavior.
