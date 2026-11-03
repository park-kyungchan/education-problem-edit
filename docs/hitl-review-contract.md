# Human review and delivery contract

This is the current executable review policy for new exam restoration operations.
It supplements the generation contracts in [question-unit-pipeline.md](question-unit-pipeline.md)
and the domain constraints in [exam-restoration-framework.md](exam-restoration-framework.md).
It was refined through the user's 2026-11-03 interview. It does not retroactively
change another owner's live operation or a frozen historical receipt.

## Boundaries and authority

Separate six work boundaries: source intake; transcription/semantics;
equations/figures; a representative pilot HWPX; remaining question batches;
whole-exam assembly/final review. **Only pilot and final require user acceptance
by default.** The other boundaries require producer checks and relevant ambiguity
resolution, not a new user approval each time. A specific user instruction can
change an operation's requirements; record it before adapting execution.

| Boundary | Required evidence / next action |
| --- | --- |
| Source intake | Original-byte hash, physical/logical order, selected questions, allowed sources and excluded references. Compare a reference draft only when allowed and available. |
| Transcription/semantics | Per-question readings and exact locations; distinguish observation, inference and a user-selected representation. |
| Equations/figures | Separate producer branches; preserve L2 equivalence choices and L3 typography; independently inspect rendered results. |
| Pilot HWPX | Select 2–3 varied questions (all if fewer than two); explain coverage of text/equation/figure/layout cases. Supply original/result comparisons and an independently checked HWPX; wait for revision-bound acceptance before scaling. |
| Remaining batches | Reuse accepted pilot choices; continue unrelated questions while a question is held; consult `scaleReady` before scaling. |
| Final assembly | All selected units current, exact final HWPX and comparison evidence checked, residuals visible, final user acceptance; `review release` must succeed before delivery. |

The active CLI owns tools, sessions and cancellation. The domain contract does
not select a model, launch agents, or send files. Local VPS paths are not accessible
review delivery. Use an authorized adapter (for example Google Drive) and supply
accessible HTTPS links for both the document and comparison. Check actual access
through that adapter; a syntactically valid URL does not prove sharing or upload.

## Interview triage and decision reconciliation

Interview uncertainties affecting **meaning, source reading, or a conflict with
an existing decision**. Handle a minor presentation choice autonomously only with
recorded evidence and an applicable rule/equivalence class. Do not invent a
numeric ambiguity/confidence threshold: the historical decision prototype treated
soft probabilities as advisory, and this contract uses the explicit semantic
conditions implemented by `needsInterview`.

Bind an issue to its question, producer stage, exact source location, item text
and evidence. An underspecified answer needs a focused location-specific follow-up;
do not turn it into an exact reading. Keep confirmed decisions fixed until a
change or contradiction occurs. Retain chronology and show the latest governing
decision; a later `hold`/`revise` supersedes an earlier `accept` for that candidate.

Unanswered source/meaning issues block their affected questions. Other questions
can continue. The user may explicitly authorize an unknown marker or approximate
representation: record `authorized-residual` with their actual instruction,
preserve the original unknown, and carry the limitation into the document,
comparison and delivery ledger. This authorizes a representation, not a claim
that the obscured source was recovered. The software returns the ledger; the
producer/verifier must check that the actual document visibly reflects it.

## Executable boundary

`src/review.ts` owns `problem-edit.review.v1`, candidate/decision chronology,
triage, scoped input digests, and readiness. `src/review-cli.ts` owns file hashes,
oracle execution and JSON admission. Both operate independently of providers.
SHA-256 uses canonical JSON with sorted object keys and ordered arrays.

- Initialize one operation with the exact selected unit inventory and pilot IDs.
  Unit/source selection changes require an explicitly new review operation.
- An issue has `id`, `questionId`, `stage`, `item`, `location`, `impact`
  (`source-meaning|presentation`), `evidence`, and `conflictsWithDecision`.
  Every string in a unit stage's `unresolved[]` must match a registered issue's
  question, stage and `item`; missing registration blocks review.
- A resolution has `issueId`, `disposition`
  (`reading|authorized-residual|presentation-choice|hold`), `actor`, and
  `instruction`. Only `user` may settle meaning/conflicts or authorize residuals.
  `agent` may record only evidenced presentation choices without a conflict.
- A candidate binds `pilot|final`, selected unit snapshots, relevant issues and
  their current resolutions, and SHA-256 pins for a versioned `.hwpx`, comparison
  and verification report. Final also binds the current pilot candidate revision.
  Store immutable candidate paths so a final build does not overwrite the pilot.
- A decision has exact `revision`, `decision` (`accept|revise|hold`),
  `actor:"user"`, and verbatim `instruction`. Candidate/decision/resolution
  history is appended. Approval of stale inputs or changed bytes is rejected.
- `planReview` reads current artifact hashes. Relevant source/content/evidence
  changes invalidate readiness. A correction outside the pilot preserves its
  acceptance; a pilot change also blocks final delivery. Stage invalidation still
  uses the existing `invalidateFrom` dependency graph.

The existing `unit plan`/`unit assemble` JSON and public functions retain their
portable v1 behavior. Their `deliverable`/`ready` values mean **generation readiness**;
they do not inspect human decisions or files. New restoration delivery uses
`review release`, which fails unless both pilot and final acceptance are current.
`review plan` reports blockers as data and exits zero for a well-formed held plan.

## CLI sequence

All commands return JSON on stdout and never overwrite inputs. Write each result
to a new operation-owned file, inspect it, then adopt that file as current.
Do not redirect a command's output onto its own `--file` input.

```sh
bun run review new --operation example --units runs/example/q1.json,runs/example/q2.json --pilot Q1,Q2 > runs/example/review-0.json
bun run review issue --file runs/example/review-0.json --event runs/example/issue.json > runs/example/review-1.json
bun run review resolve --file runs/example/review-1.json --event runs/example/resolution.json > runs/example/review-2.json
bun run review check --document runs/example/pilot-v1.hwpx --oracle runs/example/check_artifact.py > runs/example/pilot-check.json
bun run review candidate --file runs/example/review-2.json --units runs/example/q1.json,runs/example/q2.json --kind pilot --document runs/example/pilot-v1.hwpx --comparison runs/example/pilot-comparison.png --verification runs/example/pilot-check.json --document-url https://example.org/pilot --comparison-url https://example.org/comparison > runs/example/review-3.json
bun run review decide --file runs/example/review-3.json --units runs/example/q1.json,runs/example/q2.json --event runs/example/pilot-accept.json > runs/example/review-4.json
bun run review plan --file runs/example/review-4.json --units runs/example/q1.json,runs/example/q2.json
# After scaling and assembly, repeat check/candidate/decide with --kind final.
bun run review release --file runs/example/review-final.json --units runs/example/q1.json,runs/example/q2.json
```

The explicit Python oracle receives the absolute document path as its first
argument and must independently inspect the artifact. It returns JSON such as
`{"checks":[{"name":"package inspection","status":"passed"}],"native":{"status":"unknown","evidence":null}}`.
`review check` requires successful execution, at least one named passing check,
and unchanged document/oracle bytes across execution. Failed/empty checks and
exit-zero claims without that structure are rejected. It emits a versioned report
binding the document and oracle hashes; candidate creation validates that report.
The oracle's check coverage remains the operation's responsibility. A producer
returning this JSON without inspecting artifacts is not an independent oracle.

`native.status:"passed"` requires a concrete evidence reference. Otherwise use
`unknown`; delivery can be accepted with this limitation and `nativeVerified`
stays false. HWPX extension, passing structural checks, or human acceptance alone
does not qualify native Hancom rendering/editability.

These local records assume a trusted operation owner. `actor:"user"` is an
attribution contract, not authentication, an approval UI, or a tamper-proof
service. The CLI does not extract PDFs, author HWPX, detect all ambiguity, inspect
remote link permissions, or enforce another tool's dispatch. E2E tests cover the
review/verification/delivery boundary using synthetic artifacts; native Hancom
and complete source-PDF conversion remain separately unqualified.
