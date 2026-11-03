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

- `questionId` — normalized `Q<n>` (`3`, `문항 3`, `문제 7번`, `객관식 3` parse to `Q3`/`Q7`; subjective items `서답형 2`, `서술형 2`, `단답형 2`, `주관식 2`, `S2` map deterministically to the 100-offset band `Q102`);
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

`page-layout`, `package`, `native`, `delivery` are assembly-only stage IDs:
`assemble` lists them in its plan output but executes none of them, and
assembly planning never mutates unit content.

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

- `all` requires the known question inventory. Ranges and explicit lists are
  checked against the inventory when one is supplied, and expand freely
  otherwise. Unknown questions fail whenever an inventory is supplied.
  Empty selections fail. Inventory spellings are normalized and deduplicated.
- Manifest admission is one boundary (`decodeUnitManifest`): every CLI
  manifest consumer and every public planning/assembly function rejects an
  invalid manifest. `validate` reports the same checks without throwing.
- A manifest is valid only with: exact schema; canonical `questionId`
  (`Q<n>`, 1–999); `sourceSha256` as 64 lowercase hex; `physicalPage` and
  `logicalOrder` as positive safe integers; `crop` null or
  `{space:"normalized", xyxy:[x1,y1,x2,y2]}` with finite numbers and
  `0 <= x1 < x2 <= 1`, `0 <= y1 < y2 <= 1`; exactly one record per unit
  stage; `state` in `pending|ready|blocked|done|stale`; `inputRevision`,
  `outputRevision` and `contentRevision` present as string-or-null (a
  `done` stage needs a non-empty `outputRevision`); `unresolved` an array
  of strings. Strings must be well-formed Unicode (no lone UTF-16
  surrogates) so a Rust `String` can hold them. Unknown fields are ignored
  by validation and preserved by transformations.
- A unit is deliverable only when every stage is `done`; a stale or pending
  ancestor blocks delivery even if `question-layout` still says `done`.
  Unresolved items are reported in the ledger and do not by themselves
  block delivery.
- Invalidation stales only the affected branch (fixing `geometry` leaves
  `equations` done); unchanged questions are never rebuilt.
- Assembly requires one shared `sourceSha256`, unique canonical questions,
  and orders by `logicalOrder`; equal `logicalOrder` values keep input
  order. Errors: admission/argument/JSON failures print to stderr and exit
  1; `validate` prints `{valid, errors}` JSON and exits 1 when invalid.

## Rust-migration readiness

This repository has no Rust crate today and no migration slice allocates
one; do not invent a slice number. The core is nevertheless shaped for the
workspace Rust migration (pure functions, typed contracts, no I/O, no
ambient state). A mechanical port still needs the contract above frozen as
the selected callable boundary; the parity fixture below is a limited
seed, not a qualified port oracle:

| TypeScript (now) | Rust (future port) |
| --- | --- |
| `src/question.ts` pure functions | `crates/problem-edit-core/src/question.rs` |
| `src/cli.ts unit …` JSON in/out | same subcommands, same JSON shapes |
| `tests/question.test.ts` | `cargo test` with the same cases |
| `tests/fixtures/question-parity.json` | limited seed vectors (ID/selection/dependency only); a qualified oracle must freeze the full boundary incl. errors and CLI channels before any Rust parity claim |
| `bun test` | `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` |

Until a slice allocates the crate, `bun test` and `bun run check:context`
remain the only verification gates claimed here. No PDF extraction,
Hancom behavior or HWPX conversion is implemented or qualified by this
module; those still need the target-environment work in
[workflow.md](workflow.md).

## Human review and delivery

The v1 core above describes generation readiness, not human approval. New restoration operations also use [hitl-review-contract.md](hitl-review-contract.md) and `src/review.ts` / `bun run review …`. That layer checks registered uncertainties, exact candidate and artifact hashes, user-authorized residuals, and current pilot/final acceptance. `review release` is the delivery boundary; `unit assemble` remains a pure generation plan. No public v1 unit schema or parity fixture is changed.
