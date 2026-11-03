# Restore a new source exam

1. Supply the original PDF, identify the exam and preserve its bytes and hash in a separate operation. Record physical and logical page order.
2. Select the layout and output format independently. The current next-document selection is `reference-single-column` with `hwpx`.
3. Route the request through the knowledge CLI. Read applicable rules and procedures, then their exact evidence only where needed.
4. Separate printed content, handwriting and uncertain marks. Preserve unresolved source readings. Transcribe and review question text, mathematical semantics and geometry before composing pages.
5. Prepare native editable text and equations. Record figure representation and editability separately. Compose whole-question containers into a single-column flow; review overflow using the new source's content.
6. Verify the HWPX package, native equation objects, fonts and layout in the actual target environment. Deliver the document with source comparisons and an unresolved ledger. User acceptance is a separate recorded decision.

```sh
bun run layout resolve --profile reference-single-column --format hwpx
bun run knowledge route restore-exam --max-chars 6000
bun run knowledge show P-source
bun run knowledge source S-receiptD
```

The selector and retrieval commands do not perform extraction or authoring. The historical reference's twelve pages and two questions per page are observations, not defaults for a new exam. The native Hancom implementation and end-to-end conversion need target-environment qualification.
