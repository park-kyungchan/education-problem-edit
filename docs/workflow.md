# Restore a new source exam

Work is per question by default; see [question-unit-pipeline.md](question-unit-pipeline.md). Domain rules for equation canonicalization, figure label typography (`rm` vs `it`), `matplotlib mathtext (cm)` rendering, CLI adapter slots, and adversarial evaluation live in [exam-restoration-framework.md](exam-restoration-framework.md) and [meta-rubric.md](meta-rubric.md). Steps 1–2 stay exam-level. Steps 3–5 run once per selected question unit (`bun run unit …`); step 6 assembles only the selected, deliverable units and verifies artifacts through an independent oracle (`python3 scripts/verify-exam-run.py`).

The [HITL review contract](hitl-review-contract.md) governs interview triage and revision-bound pilot/final acceptance. The six work boundaries do not require six user approvals. The source/transcription/equation/figure boundaries use producer checks and relevant interviews; pilot and final require user acceptance.

1. Supply the original PDF, identify the exam and preserve its bytes and hash in a separate operation. Record physical and logical page order and allowed/excluded reference sources.
2. Select the layout and output format independently. The current next-document selection is `reference-single-column` with `hwpx`.
3. Route the request through the knowledge CLI. Read applicable rules and procedures, then their exact evidence only where needed.
4. Separate printed content, handwriting and uncertain marks. Preserve unresolved source readings. Interview meaning/source-reading uncertainty and existing-decision conflicts; record evidenced minor presentation choices autonomously. Transcribe and review question text, mathematical semantics and geometry before composing pages.
5. Prepare native editable text and equations. Record figure representation and editability separately. Compose a pilot HWPX with 2–3 varied questions (all if fewer than two), supply accessible original/result comparisons, and obtain revision-bound acceptance before scaling. Compose remaining whole-question containers into a single-column flow; review overflow using the new source's content.
6. Verify the HWPX package, native equation objects, fonts and layout in the actual target environment. Obtain exact final-candidate acceptance and run `bun run review release --file <review.json> --units <unit-files>` before delivery. Deliver with source comparisons and visible user-authorized residuals. Native equivalence remains unknown when unqualified.

```sh
bun run layout resolve --profile reference-single-column --format hwpx
bun run knowledge route restore-exam --max-chars 6000
bun run knowledge show P-source
bun run knowledge source S-receiptD
```

The selector and retrieval commands do not perform extraction or authoring. The historical reference's twelve pages and two questions per page are observations, not defaults for a new exam. The native Hancom implementation and end-to-end conversion need target-environment qualification.
