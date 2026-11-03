# Problem Edit

Tools and procedures for restoring math exams as editable documents. This is a work in progress: the current code selects a layout, but does not extract PDF content or generate an HWPX file.

## Historical implementation

`legacy/knowledge` contains selected knowledge-router source; `legacy/dual-pipeline` contains decision-pipeline source; `legacy/figures` and `legacy/composition` contain source from a previous document production. These are source references, not a runnable distribution: they depend on historical records, inputs, native tools, packages and runtime bindings that are not bundled. Local machine paths were replaced with `/LOCAL_HOME/` and `/WINDOWS_USER/` placeholders and require deliberate adaptation. Some historical implementations include live-provider and file-writing code; inspect their effects before running them.

The source PDF, old operation records, account credentials and runtime state are not part of this initial snapshot. The repository does not claim that a restored exam or end-to-end conversion has been validated in another environment.

## Layout selection

Requires Bun. Run from the repository root:

```sh
bun run layout list
bun run layout resolve --profile reference-single-column --format hwpx
bun test
```

`exam-two-column` preserves a two-column exam structure. `reference-single-column` arranges questions in a single flow. The selection and document format are independent; choosing HWPX does not choose a profile. Page counts, question counts, and exact margins depend on the source and are not prescribed by the selector.

The full restoration workflow must establish source custody, transcribe and review questions, preserve uncertainties, create and verify native equations and figures, compose pages, and verify the resulting document in a qualified native environment. This repository does not yet implement or verify that complete workflow.
