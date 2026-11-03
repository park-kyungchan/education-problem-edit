# Context map

Start with [current.json](current.json). It describes the current request and pending work. Historical records describe their original dates and scope, even when they contain words such as "current", "approved" or "next".

| Question | Owning material |
| --- | --- |
| What should the next PDF produce? | [Current selection](current.json), [workflow](../docs/workflow.md), [exam restoration framework](../docs/exam-restoration-framework.md) |
| How are workflows and outputs evaluated? | [Meta-level rubric (M1–M6)](../docs/meta-rubric.md), `python3 scripts/verify-exam-run.py` |
| Where does code belong? | [Architecture](../docs/architecture.md) |
| Which rules, procedures and cases apply? | [Knowledge routes](../packages/knowledge/releases/2026-10-22.5/routes.json), queried with `bun run knowledge route "request" --max-chars 6000` |
| What supports a knowledge claim? | A record's source ID, [source metadata](../packages/knowledge/releases/2026-10-22.5/sources.json), and its exact imported snapshot |
| What was specified and delivered for Jungdong? | [Specification](history/jungdong/work-spec.r3.json), [plan](history/jungdong/work-plan.r3.json), [status](history/jungdong/status.json), [completion decision](history/jungdong/acceptance/user-visual-review.actual.json) |
| What remains held in pipeline evaluation? | [Handoff](history/pipeline-evaluation/fresh-lead-20261023/START.json), [R7 review](history/pipeline-evaluation/harness-local-owner-r7-review/status.actual.json) |
| Which evaluation criteria were proposals? | [Rubric proposal](history/pipeline-evaluation/rubric.proposed.json), [verification proposal](history/pipeline-evaluation/verification-policy.proposed.json) |
| What is actually included here? | [Coverage and file hashes](coverage.json) |

The knowledge hierarchy is domain → layer → stage → rule/procedure/case. Its graph is in `packages/knowledge/releases/2026-10-22.5/topology.json`. Source evidence has separate ownership. Geometric incidence, document containment and pipeline dependency are different relations.

The imported corpus contains 71 curated records, 76 source references and 75 distinct snapshots. The 21 additional operation documents carry requirements, plans, decisions, checks and unresolved states. This is an explicitly selected context corpus, not every file from the original machine. The omitted 19,727-entry inventory is not bundled and the historical `knowledge find` command that uses it is unavailable. `capability` and `api` also need the unbundled Hancom research corpus. Historical absolute paths are provenance; use the imported relative snapshots for evidence. Do not replay historical commands to recover missing data automatically.
