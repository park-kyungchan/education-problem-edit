---
name: workflow-model-routing
description: CLI-agnostic complexity routing between mechanical workers and judgment/lead models across Antigravity, Muse, Claude Code, and Codex.
---

# Workflow Model Routing (CLI-Agnostic Core + Runtime Adapters)

Route each unit of work by **cognitive complexity and failure blast radius**, never by convenience or uniform model assignment.

## 1. CLI-Agnostic Complexity Contract (Core Invariant)

Every task step must be classified into one of two tiers before execution or delegation:

### Tier A — Mechanical Execution (Low Cognitive Load, Deterministic Spec)
- **Allowed scope**:
  - File/directory enumeration, byte-size and hash extraction, regex/AST token listing
  - Boilerplate data transformation or format conversion with an already-locked schema
  - Running deterministic scripts or test suites and returning raw stdout/stderr tables
- **Hard prohibitions**:
  - Must **never** resolve source ambiguity (`unknown` vs confirmed, printed line vs pencil mark)
  - Must **never** substitute an unapproved rendering fallback (e.g., substituting `DejaVuSansMono-Oblique.ttf` when `matplotlib mathtext (cm)` is mandated by `LATEX-RENDERING.md`)
  - Must **never** issue final `pass`/`fail` rubric verdicts or modify canonical decision records (`DECISIONS.md`)

### Tier B — Judgment, Synthesis, & Adversarial Verification (Lead / Reasoning Tier)
- **Sub-levels**:
  - **Low (`low`)**: Routine single-file code/doc edits following an already-verified plan; local consistency checks.
  - **Medium (`medium`)**: Per-question equation canonicalization (`EQ-CANONICAL.md`), label typography classification (`rm` vs `it` vs mixed `tspan`), SVG/PNG coordinate & anchor tuning, code refactoring.
  - **High (`high`)**: Architecture and meta-rubric design (`META-RUBRIC.md`), cross-document contradiction hunting, visual inspection of rendered figures against source PDFs, ambiguity gate decisions (`U1`–`U5`), and final independent oracle verification (`verify_outputs.py`, `bun test`, `bun run check:context`).

---

## 2. Per-CLI Runtime Adapter Mapping (Slot Table)

The core tier classification above is invariant across all host CLIs. Only the model identifier and effort/thinking parameter change per runner:

| Host CLI Runner | Tier A: Mechanical Worker | Tier B (Low / Medium): Standard Judgment | Tier B (High): Lead / Adversarial Verification | Native Config / Invocation |
|---|---|---|---|---|
| **Antigravity (`agy`)** | `gemini-3.8-flash` (**`medium` only** — never `low` or `high`) | `gemini-4-argon` (`low` or `medium`) | `gemini-4-argon` (`high`) | `invoke_subagent` (`Model`) / lead session |
| **Muse** | `muse-spark-1.3` (`high`) | `muse-wonder-1.0` (`medium`) | `muse-wonder-1.0` (`high`) | `muse.workflow` (`nodes.<id>.model`, `effort`) |
| **Claude Code (`claude`)** | `claude-haiku-4-5` | `claude-sonnet-4-6` (`medium`) | `claude-opus-4-7` / `claude-sonnet-4-6` (`high`) | Subagent / `--model` / effort setting |
| **Codex (`codex`)** | `gpt-5.4-mini` (`medium`) | `gpt-5.4` (`medium`) | `gpt-5.4` (`high` / `xhigh`) | `-m` / `model_reasoning_effort` |

---

## 3. Mandatory Verification & Handoff Gates

1. **No Self-Certifying Mechanical Work**: Output from a Tier A worker is raw input, never a verified deliverable. A Tier B (`medium`/`high`) agent must verify the artifact through an **independent oracle** (e.g., XML/DOM parser, pixel/margin check, SHA-256 parity check) before acceptance.
2. **No Silent Fallback Downgrades**: If a Tier A/B worker encounters a missing dependency (such as `matplotlib` in `.venv`), it must install the dependency or halt at the gate — never silently downgrade to a non-compliant font or raster hack.
3. **Lossless State Sync**: Whenever user feedback alters geometry, typography, or scope during review, update `DECISIONS.md` and the inventory spec in the same turn as the code edit so subsequent agents never face conflicting instructions.
