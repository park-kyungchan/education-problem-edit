# Per-question (문항단위) pipeline

The default unit of work is one question, not one PDF. A whole exam is an
assembly of finished units, never the intake granularity. This refines
[workflow.md](workflow.md): steps 1–2 (source custody, layout choice) stay
exam-level; everything after that runs per question.

## Why

Whole-PDF intake couples unrelated questions: one unreadable figure blocks
twenty good questions, one correction re-runs the whole exam, and review
feedback cannot be attributed to a single producer stage. Per-question
units give isolated intake, isolated failure, selective rebuild and
per-question acceptance, matching `R-question-container` (a whole question
is already the native copy unit) and `R-selective-invalidation`.

## Unit contract

`src/question.ts` is the portable, I/O-free core. A unit manifest
(`problem-edit.question-unit.v1`) binds:

- `questionId` — normalized `Q<n>` (`3`, `문항 3`, `문제 7번` all parse);
- `source` — `sourceSha256`, `physicalPage`, `logicalOrder` (kept separate
  per `R-source-order`) and an optional normalized crop;
- `stages` — one record per stage with `state`
  (`pending|ready|blocked|done|stale`), `inputRevision`, `outputRevision`
  and a per-stage `unresolved` list (per `R-uncertainty`: unknowns stay
  explicit, never solved into existence);
- `contentRevision` — cleared whenever any stage goes stale.

Unit stages, in dependency order (subset of the knowledge `flows.json`):

```text
regions -> transcription -> semantics -> geometry -> assets -+
                    \-> equations ----------------------------+-> question-layout
```

`page-layout`, `package`, `native`, `delivery` are assembly-only: they run
when selected units are composed, and never mutate unit content.

## Operations

```sh
bun run unit parse "문항 3"                 # -> single Q3
bun run unit parse "Q3-Q5"                  # -> range
bun run unit parse "Q3,Q7" --available Q1,Q2,Q3,Q7
bun run unit new --source-sha <64hex> --question Q3 --physical-page 2 --logical-order 3 > runs/q3.json
bun run unit validate --file runs/q3.json
bun run unit plan --file runs/q3.json       # runnable stages + blockers + unresolved ledger
bun run unit invalidate --file runs/q3.json --stage geometry   # stale: geometry, assets, question-layout only
bun run unit assemble --file runs/q3.json,runs/q7.json         # one source, unique, logical order
```

Rules enforced by the core and its tests:

- `all`/ranges require the known question inventory; unknown questions fail.
- A `done` stage must carry an `outputRevision`; missing/duplicate stages fail.
- Invalidation stales only the affected branch (fixing `geometry` leaves
  `equations` done); unchanged questions are never rebuilt.
- Assembly requires one shared `sourceSha256`, unique questions, and orders
  by `logicalOrder`, not request order.

## Rust-migration readiness

This repository has no Rust crate today and no migration slice allocates
one; do not invent a slice number. The core is nevertheless shaped for the
workspace Rust migration (pure functions, typed contracts, deterministic
JSON, no I/O, no ambient state) so a future `crates/problem-edit-core`
ports it mechanically:

| TypeScript (now) | Rust (future port) |
| --- | --- |
| `src/question.ts` pure functions | `crates/problem-edit-core/src/question.rs` |
| `src/cli.ts unit …` JSON in/out | same subcommands, same JSON shapes |
| `tests/question.test.ts` | `cargo test` with the same cases |
| `tests/fixtures/question-parity.json` | frozen parity vectors; expected values come from this document, never from the port candidate |
| `bun test` | `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` |

Until a slice allocates the crate, `bun test` and `bun run check:context`
remain the only verification gates claimed here. No PDF extraction,
Hancom behavior or HWPX conversion is implemented or qualified by this
module; those still need the target-environment work in
[workflow.md](workflow.md).
