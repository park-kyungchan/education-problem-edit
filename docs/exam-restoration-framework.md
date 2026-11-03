# CLI-Agnostic Exam Restoration Framework (L1–L5)

This document promotes the generalizable math-exam restoration rules established during the Yeoksam Grade 3 operation (`runs/yeoksam-grade3-20261103/framework/`) into the tracked repository so every subsequent operation triggers them at entry (`Axis M3` of [`docs/meta-rubric.md`](meta-rubric.md)).

---

## 1. Five-Layer Restoration Contract (L1–L5)

Every exam restoration operation proceeds through five ordered layers. Do not advance past a layer whose stop condition is active.

### L1 — Source Fidelity & Ambiguity Gate
1. Record the operation's allowed sources first. Compare the source PDF against a draft/reference HWP or HWPX only when it is allowed and available. A PDF-only user boundary overrides reference comparison; record the unavailable/excluded reference without reading it.
2. Separate **printed exam elements** from **student pencil marks, red grading circles, and margin calculations**. Never crop raw scan regions containing handwriting into deliverables.
3. Any unconfirmed ambiguity (e.g., whether an interior auxiliary segment is printed or penciled, curriculum scope exceptions, cover header metadata) must be named (`U1`, `U2`, ...) and recorded in the operation's `DECISIONS.md` before final packaging. Apply the [HITL review contract](hitl-review-contract.md): interview meaning/source-reading uncertainty and decision conflicts, handle evidenced minor presentation choices autonomously, and preserve user-authorized unknown/approximate representations.

### L2 — Equation Canonicalization & Equivalence Classes (Hancom EqEdit)
1. **Semantic Invariants (Mandatory Fix on Violation)**:
   - Segment bar vs. arc: line segments use `overline {rm{AB}}` or `bar{rm{AB}}`; circular arcs use `arch {rm{AB}}` (never `arc`, which renders the text `arc` in EqEdit).
   - Inequality tokens: `LEQ` and `GEQ` must appear at main expression level, never inside a subscript (`_{LEQ}`).
   - Command token spacing: leave a space or brace boundary between commands and operands (avoid glued tokens like `0rm m` or `rmbar{AB}` in newly authored equations).
2. **Formatting Equivalence Classes (Preserve Existing HITL Choices)**:
   - Do not bulk-rewrite existing valid equations across equivalent representations (`^CIRC` vs `^{circ}`, outer vs per-letter `rm{...}` wrapping, `LEFT (` vs `(` for single-line expressions). Only enforce canonical forms on newly authored or semantically broken equations.

### L3 — Figure Reconstruction, Label Typography, & LaTeX Rendering
1. **Vector-First Reconstruction**:
   - Reconstruct geometric figures programmatically (`draw_<id>.py` → editable `.svg` + high-resolution `.png`). Reserve generative image models strictly for photographic textures.
   - Maintain a minimum 4-pixel white margin inside all four canvas borders so labels never clip (`edge-clipping guard`).
2. **Label Typography Contract (`rm` vs `it` vs Mixed)**:
   - **Upright (`rm`, sans-serif normal)**: Uppercase geometric point names (`A`–`Z`, `O`, `P`, `Q`, `R`, `M`, `T`), numeric constants (`1`, `3`, `4`, `6`, `12`, `-3`), units, parentheses, commas, and the degree symbol (`°`).
   - **Math Italic (`it`, serif italic)**: Unknowns, variables, coordinate axes, angle variables, and lowercase line names (`x`, `y`, `a`, `b`, `p`, `q`, `m`, `n`, `l`).
   - **Character-Level Mixed Split**: Combined labels (`R(p, q)`, `a°`, `b°`, `x°`) must split upright and italic tokens at the character level — never italicize the entire string (which slants parentheses or `°`) and never leave variables upright.
3. **Primary Rendering Route (`matplotlib mathtext` with `cm` Fontset)**:
   - For PNG raster outputs containing convertible italic/math labels (`$x$`, `$y$`, `$a$`, `$b$`, `$l$`, `$a^{\circ}$`, `$b^{\circ}$`, `$x^{\circ}$`, `$\mathrm{R}(p, q)$`, multi-token equations like `$y=\frac{3}{2}x-3$`), render transparent RGBA fragments via **`matplotlib` `mathtext` with `mpl.rcParams["mathtext.fontset"] = "cm"`** (Computer Modern) and composite with Pillow.
   - **Hard Prohibition**: Never substitute monospace or sans-serif oblique fonts (such as `DejaVuSansMono-Oblique.ttf`) for math italic labels in PNGs.
   - **SVG/PNG Content Parity**: Every label, dimension number, and arrowhead drawn in the PNG must also be present in the paired SVG (`<text>`/`<tspan>`/`<image>`/`<polygon>`).

### L4 — Document Layout & Choice Alignment
1. Keep layout profile selection (`exam-two-column` vs `reference-single-column`) independent of output container format (`hwp` vs `hwpx`).
2. Place multiple-choice options in separate equation objects aligned by table cells rather than stacking choices inside a single equation box.

### L5 — Independent Oracle Verification & Lossless Handoff
1. **Never self-certify by re-running generator scripts**: Use an operation-owned independent oracle that actually inspects SVG XML DOMs, PNG pixels/margins, renderer AST and HWPX embedded bytes as applicable, plus schema validation when available. `python3 scripts/verify-exam-run.py <run-dir>` only dispatches that operation's `verify_outputs.py`; it does not implement those checks itself. Missing runs currently return SKIP/exit zero, and a missing oracle in an existing run fails. Inspect actual output and coverage. The [review adapter](hitl-review-contract.md) additionally binds a structured verification report to the candidate document hash.
2. **Lossless Decision Sync**: Every user instruction received during interactive visual review must be recorded in `DECISIONS.md` and synced to `IMAGE-INVENTORY.md` in the same turn as the code change. Preserve chronology and the latest governing instruction, with exact pilot/final candidate acceptance; generation completion is separate from human approval.

---

## 2. CLI Adapter Slots (A1–A5)

The L1–L5 domain rules above are invariant across all host CLIs (`Antigravity`, `Muse`, `Claude Code`, `Codex`). Only the adapter slots below vary by runtime:

| Slot | Responsibility | CLI-Agnostic Invariant |
|---|---|---|
| **A1: Tooling & I/O** | File reading, HWP/HWPX extraction (`pyhwp`, `python-hwpx`), shell execution | Must preserve immutable evidence hashes (`bun run check:context`) |
| **A2: Model Routing** | Mapping Mechanical (Tier A) vs Judgment/Lead (Tier B) tasks to runner models | See [`.agents/skill-drafts/workflow-model-routing/SKILL.md`](../.agents/skill-drafts/workflow-model-routing/SKILL.md) |
| **A3: Vector & Math Renderer** | Python Pillow + `matplotlib` (`mathtext.fontset="cm"`) + SVG emitter | Must pass `scripts/verify-exam-run.py` |
| **A4: Native Hancom Runtime** | Opening final HWP/HWPX in native Hancom Office when available | When unavailable (Linux container), keep unverified visual equivalence claims marked `unknown` |
| **A5: Independent Verifier** | `bun test`, `bun run check:context`, `python3 scripts/verify-exam-run.py` | Must inspect generated artifacts independently of generator scripts |
