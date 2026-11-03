# Repository structure and ownership

```text
problem-edit/
  AGENTS.md                         repository-specific agent guidance
  src/                              portable layout + per-question pipeline core and CLI
  tests/                            selector and question-unit tests (+ parity fixtures)
  packages/
    knowledge/
      src/                          knowledge router implementation
      current.json                  selects the retained immutable release
      releases/2026-10-22.5/
        records/                    rules, procedures and cases
        snapshots/                  exact supporting evidence bytes
        routes.json                 task-to-knowledge routing
        sources.json                provenance, hashes and snapshot locations
        topology.json               typed knowledge hierarchy
    decision-prototype/             historical decision and provider code
    figure-authoring/               historical figure source
    document-composition/           historical HWPX composition source
  context/
    current.json                    current selection and unresolved work
    README.md                       question-to-source map
    coverage.json                   import scope, exclusions and hashes
    history/                        selected immutable operation documents
  docs/                             architecture and restoration workflow
  scripts/                          local integrity checks
  runs/                             ignored per-source inputs and outputs
```

The three historical production packages were moved from `legacy/` without changing their code in this restructuring. They still contain unresolved `/LOCAL_HOME/` or `/WINDOWS_USER/` placeholders and external dependencies. They are not a verified production pipeline. The knowledge package now includes its selected release, so route/show/source/trace/impact/layout/summary/validate can read repository-local evidence. Its old broad inventory and Hancom research corpus remain external; do not infer support for `find`, `api` or `capability` from their presence in the historical CLI help.

The frozen release and operation documents retain original bytes. Keep observed counts and native environment measurements scoped to their source exam. Do not edit frozen receipts to repair current implementation; add a new operation or knowledge release with explicit lineage instead.

The original machine's operation directories remain intact because their absolute paths and hashes are part of historical evidence. This repository is the development and context entrypoint for the transferred problem-edit work. It does not relocate the original native runtime, credentials, sessions or common-Harness implementations.

Per-question work is owned by `src/question.ts` (pure contracts, planning, selective invalidation, assembly) behind `bun run unit …`; see `docs/question-unit-pipeline.md`. It is shaped for a future Rust port but this repository has no Rust crate or migration slice today.
