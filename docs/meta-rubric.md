# Meta-Level Rubric for Pipeline & Exam Restoration Workflows (M1–M6)

This tracked document codifies the six meta-evaluation axes (`M1`–`M6`) and the adversarial findings from the Yeoksam Grade 3 evaluation (`runs/yeoksam-grade3-20261103/framework/META-RUBRIC.md`). Use this rubric to audit any new pipeline change, skill definition, or exam operation under `runs/<operation>/`.

---

## 1. The Six Meta-Evaluation Axes (M1–M6)

| Axis | Dimension | Pass Criteria | Failure Signature (Breaking Point) | Independent Oracle |
|---|---|---|---|---|
| **M1** | **CLI-Agnostic Contract vs. CLI/LLM Autonomy** | Domain invariants (L1–L5 restoration rules, EqEdit canonical forms, label typography, complexity tiers) are cleanly separated from per-CLI adapter slots (`Antigravity`, `Muse`, `Claude Code`, `Codex`). | A top-level instruction or skill hardcodes one runner's namespace or model IDs (`muse.workflow`, `muse-spark-1.3`, `Native Codex owns...`), breaking portability across host CLIs. | Inspect `AGENTS.md`, `docs/exam-restoration-framework.md`, and `.agents/skill-drafts/workflow-model-routing/SKILL.md`. |
| **M2** | **Instruction Conflict, Duplication, & Waste Prevention** | Zero contradictions across `DECISIONS.md`, `IMAGE-INVENTORY.md`, rubrics, and `draw_*.py`; zero redundant serialization loops or undocumented unbundled-corpus crashes in CLI tools. | Specs state `b = arc only` or `unknown` while `DECISIONS.md` / `draw_*.py` implement a hatched sector; CLI `help` advertises unbundled corpus commands without warning, causing `ENOENT` turn waste. | Cross-document diff audit + `bun test` + `bun run check:context`. |
| **M3** | **Execution-Time Rule Triggering** | Entry documents (`AGENTS.md` → `context/README.md` → `docs/workflow.md`) link directly to active domain rules and gates, and the unit parser (`src/question.ts`) accepts real Korean exam question IDs (`객관식 3`, `서답형 2`, `S2`). | Rules live only in gitignored `runs/` directories; 75% of figure scripts ignore a newly written `LATEX-RENDERING.md` spec; `unit parse` throws on `서답형 2` / `S2`. | Entry-link reachability check + `tests/question.test.ts` + `scripts/verify-exam-run.py`. |
| **M4** | **Independent Verification Oracle** | Verification inspects final artifacts (`*.svg` XML DOM, `*.png` pixels/borders, `draw_*.py` AST, `*.hwpx` `BinData` SHA-256 hashes, OWPML schemas) via an independent verifier rather than re-running generator scripts. | Re-running `python draw_q9.py` prints `saved q9.png / q9.svg` (`exit 0`), hiding that `q9.svg` omitted `<text>` nodes for `6, 4, 3`, `s4.svg` omitted arrowheads, and `.hwpx` embedded stale PNGs. | `python3 scripts/verify-exam-run.py <run-dir>` + `hwpx-validate`. |
| **M5** | **Complexity-Based Model Routing** | Mechanical tasks (Tier A: enumeration, raw extraction) route to fast/light models (`Antigravity`: `gemini-3.8-flash` `medium` only; `Muse`: `muse-spark-1.3` `high`), while judgment, typography, ambiguity resolution, and final verification route to reasoning models (`Antigravity`: `gemini-4-argon` `low`/`medium`/`high`; `Muse`: `muse-wonder-1.0` `medium`/`high`). | Delegating typographic implementation choices to a mechanical worker that substitutes `DejaVuSansMono-Oblique.ttf` for `matplotlib mathtext (cm)`, or accepting subagent output without Lead oracle verification. | `.agents/skill-drafts/workflow-model-routing/SKILL.md` + Lead verification log. |
| **M6** | **Lossless State & Decision Handoff** | All user decisions (`U1`–`U5`, `FMT`) and interactive visual review instructions (`G-Q2`–`G-S3`, `TYPO-1`, `LATEX-1`) are recorded in `DECISIONS.md` and synced to specs and packaged `.hwpx` outputs in the same turn. | Interactive user edits exist only as `# per user instruction` comments inside `draw_*.py`; `.hwpx` is built before the last `draw_*.py` edit; stray nested `runs/.../runs/` directories remain. | `DECISIONS.md` ↔ `IMAGE-INVENTORY.md` ↔ `draw_*.py` ↔ `.hwpx` SHA-256 parity check. |

---

## 2. Summary of Remediated Breaking Points (2026-11-03)

1. **LaTeX Primary Route Enforcement (`Y-01`)**: Upgraded `draw_q3.py`, `draw_s2.py`, and `draw_s4.py` in `runs/yeoksam-grade3-20261103/images/` from `DejaVuSansMono-Oblique.ttf` to `matplotlib` `mathtext` (`mathtext.fontset = "cm"`) transparent RGBA fragments, achieving 100% compliance across all 4 convertible-label figures (`q3`, `q5`, `s2`, `s4`).
2. **SVG/PNG Content Parity (`Y-02`)**: Added missing `<text>` dimension labels `6`, `4`, `3` to `q9.svg`, added curved arc paths and `<polygon>` arrowheads to `s4.svg`, and added explicit `font-style="normal"` attributes across `q9.svg`, `q11.svg`, and `s2.svg`.
3. **Decision & Spec Reconciliation (`Y-03`, `Y-05`)**: Recorded all 8 interactive user geometry decisions (`G-Q2`–`G-S3`) plus `TYPO-1` and `LATEX-1` in `DECISIONS.md`, and reconciled `IMAGE-INVENTORY.md`, `RUBRIC-v2.md`, `LATEX-RENDERING.md`, `EQ-SCAN.md`, `label-audit-*.md`, and `README.md`.
4. **HWPX Binary Sync & Google Drive Sync (`Y-04`)**: Synchronized `BinData/BIN0001..0011.png` and `Preview/PrvText.txt` in `yeoksam-grade3-final-draft.hwpx`, verified schema compliance with `hwpx-validate`, and synced all updated `.png`, `.svg`, and `.hwpx` files to Google Drive (`problem-edit/output/yeoksam-grade3`).
5. **Pipeline & Routing Improvements (`P-01`–`P-07`)**:
   - Made `.agents/skill-drafts/workflow-model-routing/SKILL.md` and `AGENTS.md` CLI-agnostic across `Antigravity`, `Muse`, `Claude Code`, and `Codex`.
   - Extended `parseQuestionId` and `parseUnitSelection` in `src/question.ts` to support Korean multiple-choice (`객관식 3`) and subjective (`서답형 2`, `서술형 4`, `S2` $\to$ `Q102`) identifiers while preserving all frozen parity vectors.
   - Removed redundant JSON re-serialization in `packages/knowledge/src/cli.ts` and `compact.ts` and added clear error messages for unbundled external corpora.
   - Added tracked independent verifier `scripts/verify-exam-run.py`.
