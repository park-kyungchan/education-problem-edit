# Problem Edit

Math exam restoration code, curated knowledge and selected historical context in one repository.

Start with the [context map](context/README.md), [current selection](context/current.json), [architecture and directory tree](docs/architecture.md), and [restoration workflow](docs/workflow.md). Repository agent guidance is in [AGENTS.md](AGENTS.md).

## Run

Requires Bun. From the repository root:

```sh
bun test
bun run check:context
bun run layout resolve --profile reference-single-column --format hwpx
bun run knowledge route restore-exam --max-chars 6000
```

The next-document selection is a single-column reference layout and HWPX format. The portable selector and knowledge retrieval are runnable. The historical decision, figure and composition packages need dependency and native-environment work before complete PDF-to-HWPX restoration can be claimed.

## Structure

`src/` owns the portable selector. `packages/` owns knowledge, the decision prototype, figure authoring and document composition. `context/` owns the current transfer state, the historical requirements/decisions/checks, and the import coverage manifest. `docs/` explains the workflow and boundaries. New per-source inputs and outputs belong in ignored `runs/`.

The retained knowledge release includes 71 rule/procedure/case records, 76 source references and 75 distinct evidence snapshots. Another 21 selected operation documents describe past requirements, plans, completion decisions and held work. [coverage.json](context/coverage.json) records every imported file hash and all known exclusions. The historical broad file inventory, complete Hancom research corpus, original PDFs, native deliveries and native runtime state are not bundled. Historical source paths are provenance, not portable dependencies. Full local-context collection and end-to-end authoring verification are not claimed.
