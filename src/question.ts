/**
 * Per-question (문항단위) pipeline contracts and planning.
 *
 * The whole-exam pipeline in docs/workflow.md stays the assembly path.
 * This module makes a single question the unit of intake, transcription,
 * verification, invalidation and delivery, so work on one question never
 * requires re-running or re-verifying the whole PDF.
 *
 * Stage IDs and dependency edges mirror the retained knowledge release
 * (packages/knowledge/releases/2026-10-22.5/stages.json, flows.json) and
 * rules R-source-order, R-uncertainty, R-question-container and
 * R-selective-invalidation. This module is portable: it performs no I/O,
 * no model calls and no document conversion.
 */

export type UnitStageId =
  | "regions"
  | "transcription"
  | "semantics"
  | "geometry"
  | "assets"
  | "equations"
  | "question-layout";

export type AssemblyStageId = "page-layout" | "package" | "native" | "delivery";

export type StageState = "pending" | "ready" | "blocked" | "done" | "stale";

export interface StageRecord {
  stage: UnitStageId;
  state: StageState;
  inputRevision: string | null;
  outputRevision: string | null;
  unresolved: string[];
}

export interface SourceBinding {
  sourceSha256: string;
  physicalPage: number;
  logicalOrder: number;
  crop: { space: "normalized"; xyxy: [number, number, number, number] } | null;
}

export interface QuestionUnitManifest {
  schema: "problem-edit.question-unit.v1";
  questionId: string;
  source: SourceBinding;
  stages: StageRecord[];
  contentRevision: string | null;
}

export interface UnitSelection {
  kind: "single" | "subset" | "range" | "all";
  questionIds: string[];
}

/** Stages that produce one question, in dependency (topological) order. */
export const unitStages: readonly UnitStageId[] = [
  "regions",
  "transcription",
  "semantics",
  "geometry",
  "assets",
  "equations",
  "question-layout",
];

/** Assembly stages run only when selected units are composed together. */
export const assemblyStages: readonly AssemblyStageId[] = [
  "page-layout",
  "package",
  "native",
  "delivery",
];

/** Direct dependencies within one question (subset of flows.json). */
export const unitDependencies: Readonly<Record<UnitStageId, readonly UnitStageId[]>> = {
  regions: [],
  transcription: ["regions"],
  semantics: ["transcription"],
  geometry: ["semantics"],
  assets: ["geometry"],
  equations: ["transcription"],
  "question-layout": ["transcription", "assets", "equations"],
};

const SHA256_RE = /^[a-f0-9]{64}$/;

/**
 * Normalize Korean and alphanumeric question identifiers to canonical "Q<n>".
 * - Multiple-choice / standard items ("3", "q3", "Q03", "3번", "문항 3", "문제 3", "객관식 3", "선택형 3") -> "Q3" (1..999).
 * - Subjective / constructed-response items ("서답형 2", "서술형 2", "단답형 2", "주관식 2", "S2", "s02") -> "Q102" (100 + n for n in 1..99).
 */
export function parseQuestionId(raw: string): string {
  const trimmed = raw.trim().replace(/번$/u, "").trim();
  const subjMatch = trimmed.match(/^(?:(?:서답형|서술형|단답형|주관식)\s*(?:문항\s*|문제\s*)?|[Ss])0*(\d{1,2})$/u);
  if (subjMatch) {
    const sn = Number(subjMatch[1]);
    if (!Number.isInteger(sn) || sn < 1 || sn > 99) throw new Error(`Invalid question id: ${raw}`);
    return `Q${100 + sn}`;
  }
  const cleaned = trimmed.replace(/^(?:객관식|선택형)?\s*(?:문항|문제)?\s*/u, "").trim();
  const match = cleaned.match(/^[Qq]?0*(\d{1,3})$/);
  if (!match) throw new Error(`Invalid question id: ${raw}`);
  const n = Number(match[1]);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid question id: ${raw}`);
  return `Q${n}`;
}

function questionNumber(id: string): number {
  return Number(id.slice(1));
}

/**
 * Parse a unit selection such as "Q3", "Q3,Q7", "Q3-Q5", "서답형 2-서답형 4", "S2-S4" or "all".
 * `available` bounds "all" and ranges; without it a range is still expanded
 * but "all" is rejected because the exam inventory is unknown.
 */
export function parseUnitSelection(raw: string, available?: readonly string[]): UnitSelection {
  const text = raw
    .trim()
    .replace(/(객관식|선택형|서답형|서술형|단답형|주관식|문항|문제)\s+(?=(?:문항|문제|\d))/gu, "$1")
    .replace(/(객관식|선택형|서답형|서술형|단답형|주관식)(?:문항|문제)\s*(?=\d)/gu, "$1");
  if (!text) throw new Error("Empty unit selection");
  const known = available ? [...new Set(available.map(parseQuestionId))] : undefined;

  if (text === "all" || text === "전체" || text === "*") {
    if (!known || known.length === 0) {
      throw new Error("Selection 'all' requires the known question inventory");
    }
    return { kind: "all", questionIds: [...known].sort((a, b) => questionNumber(a) - questionNumber(b)) };
  }

  const range = text.match(/^(.+?)\s*[-~]\s*(.+)$/);
  if (range && !text.includes(",")) {
    const from = questionNumber(parseQuestionId(range[1]));
    const to = questionNumber(parseQuestionId(range[2]));
    if (to < from) throw new Error(`Invalid question range: ${raw}`);
    const ids: string[] = [];
    for (let n = from; n <= to; n += 1) ids.push(`Q${n}`);
    if (known) {
      const missing = ids.filter((id) => !known.includes(id));
      if (missing.length) throw new Error(`Questions not in source inventory: ${missing.join(", ")}`);
    }
    return { kind: "range", questionIds: ids };
  }

  const ids = [...new Set(text.split(/[,\s]+/).filter(Boolean).map(parseQuestionId))].sort(
    (a, b) => questionNumber(a) - questionNumber(b),
  );
  if (ids.length === 0) throw new Error("Empty unit selection");
  if (known) {
    const missing = ids.filter((id) => !known.includes(id));
    if (missing.length) throw new Error(`Questions not in source inventory: ${missing.join(", ")}`);
  }
  return { kind: ids.length === 1 ? "single" : "subset", questionIds: ids };
}

/** Create a fresh unit manifest; every stage starts pending. */
export function createUnitManifest(input: {
  sourceSha256: string;
  questionId: string;
  physicalPage: number;
  logicalOrder?: number;
  crop?: [number, number, number, number] | null;
}): QuestionUnitManifest {
  if (!SHA256_RE.test(input.sourceSha256)) {
    throw new Error("sourceSha256 must be 64 lowercase hex characters");
  }
  if (!Number.isSafeInteger(input.physicalPage) || input.physicalPage < 1) {
    throw new Error("physicalPage must be a positive safe integer");
  }
  const logicalOrder = input.logicalOrder ?? input.physicalPage;
  if (!Number.isSafeInteger(logicalOrder) || logicalOrder < 1) {
    throw new Error("logicalOrder must be a positive safe integer");
  }
  const crop = input.crop ?? null;
  if (crop) {
    const [x1, y1, x2, y2] = crop;
    if (!(x1 >= 0 && y1 >= 0 && x2 > x1 && y2 > y1 && x2 <= 1 && y2 <= 1)) {
      throw new Error("crop must satisfy 0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1 (normalized)");
    }
  }
  return {
    schema: "problem-edit.question-unit.v1",
    questionId: parseQuestionId(input.questionId),
    source: {
      sourceSha256: input.sourceSha256,
      physicalPage: input.physicalPage,
      logicalOrder,
      crop: crop ? { space: "normalized", xyxy: crop } : null,
    },
    stages: unitStages.map((stage) => ({
      stage,
      state: "pending" as const,
      inputRevision: null,
      outputRevision: null,
      unresolved: [],
    })),
    contentRevision: null,
  };
}

const STAGE_STATES: readonly string[] = ["pending", "ready", "blocked", "done", "stale"];
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkText(value: unknown, label: string, errors: string[]): void {
  // Strings must be well-formed Unicode so a Rust String can hold them.
  if (typeof value === "string" && LONE_SURROGATE.test(value)) {
    errors.push(`${label} contains a lone UTF-16 surrogate`);
  }
}

function checkRevision(value: unknown, label: string, errors: string[]): void {
  if (value !== null && typeof value !== "string") errors.push(`${label} must be a string or null`);
  else checkText(value, label, errors);
}

/**
 * Strict structural validation; returns errors (empty = valid).
 * Never throws on malformed input. Contract (v1): schema exact; questionId
 * canonical `Q<n>`; pages positive safe integers; crop null or a normalized
 * 4-number box; exactly one record per unit stage; state in the enum;
 * revisions string-or-null; unresolved an array of well-formed strings;
 * contentRevision present as string-or-null. Unknown fields are ignored
 * here and preserved by transformations (forward compatibility).
 */
export function validateUnitManifest(m: QuestionUnitManifest): string[] {
  const errors: string[] = [];
  if (!isRecord(m)) return ["manifest must be a JSON object"];
  if (m.schema !== "problem-edit.question-unit.v1") errors.push(`Unknown schema: ${String(m.schema)}`);
  if (typeof m.questionId !== "string") {
    errors.push("questionId must be a string");
  } else {
    try {
      if (parseQuestionId(m.questionId) !== m.questionId) {
        errors.push(`questionId must be canonical (e.g. Q3): ${m.questionId}`);
      }
    } catch {
      errors.push(`Invalid questionId: ${m.questionId}`);
    }
  }
  if (!("contentRevision" in m)) errors.push("Missing contentRevision");
  else checkRevision(m.contentRevision, "contentRevision", errors);

  if (!isRecord(m.source)) {
    errors.push("source must be an object");
  } else {
    if (typeof m.source.sourceSha256 !== "string" || !SHA256_RE.test(m.source.sourceSha256)) {
      errors.push("source.sourceSha256 must be 64 lowercase hex characters");
    }
    if (!Number.isSafeInteger(m.source.physicalPage) || (m.source.physicalPage as number) < 1) {
      errors.push("source.physicalPage must be a positive safe integer");
    }
    if (!Number.isSafeInteger(m.source.logicalOrder) || (m.source.logicalOrder as number) < 1) {
      errors.push("source.logicalOrder must be a positive safe integer");
    }
    const crop = m.source.crop;
    if (crop !== null && crop !== undefined) {
      if (!isRecord(crop) || crop.space !== "normalized" || !Array.isArray(crop.xyxy) || crop.xyxy.length !== 4) {
        errors.push("source.crop must be null or {space:\"normalized\", xyxy:[x1,y1,x2,y2]}");
      } else {
        const [x1, y1, x2, y2] = crop.xyxy as unknown[];
        if (![x1, y1, x2, y2].every((n) => typeof n === "number" && Number.isFinite(n))) {
          errors.push("source.crop.xyxy must be four finite numbers");
        } else if (!((x1 as number) >= 0 && (y1 as number) >= 0 && (x2 as number) > (x1 as number) && (y2 as number) > (y1 as number) && (x2 as number) <= 1 && (y2 as number) <= 1)) {
          errors.push("source.crop must satisfy 0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1 (normalized)");
        }
      }
    }
  }

  if (!Array.isArray(m.stages)) {
    errors.push("stages must be an array");
    return errors;
  }
  const seen = new Set<string>();
  for (const rec of m.stages as unknown[]) {
    if (!isRecord(rec)) {
      errors.push("each stage record must be an object");
      continue;
    }
    if (typeof rec.stage !== "string" || !(unitStages as readonly string[]).includes(rec.stage)) {
      errors.push(`Unknown stage: ${String(rec.stage)}`);
      continue;
    }
    if (seen.has(rec.stage)) errors.push(`Duplicate stage: ${rec.stage}`);
    seen.add(rec.stage);
    if (typeof rec.state !== "string" || !STAGE_STATES.includes(rec.state)) {
      errors.push(`Stage ${rec.stage} has invalid state: ${String(rec.state)}`);
    }
    if (!("inputRevision" in rec)) errors.push(`Stage ${rec.stage} is missing inputRevision`);
    else checkRevision(rec.inputRevision, `Stage ${rec.stage} inputRevision`, errors);
    if (!("outputRevision" in rec)) errors.push(`Stage ${rec.stage} is missing outputRevision`);
    else checkRevision(rec.outputRevision, `Stage ${rec.stage} outputRevision`, errors);
    if (rec.state === "done" && (typeof rec.outputRevision !== "string" || rec.outputRevision.length === 0)) {
      errors.push(`Stage ${rec.stage} is done without outputRevision`);
    }
    if (!Array.isArray(rec.unresolved) || !(rec.unresolved as unknown[]).every((u) => typeof u === "string")) {
      errors.push(`Stage ${rec.stage} unresolved must be an array of strings`);
    } else {
      (rec.unresolved as string[]).forEach((u, i) => checkText(u, `Stage ${rec.stage} unresolved[${i}]`, errors));
    }
  }
  for (const stage of unitStages) {
    if (!seen.has(stage)) errors.push(`Missing stage: ${stage}`);
  }
  return errors;
}

/** Admission boundary: decode unknown JSON into a checked manifest or throw. */
export function decodeUnitManifest(raw: unknown): QuestionUnitManifest {
  const errors = validateUnitManifest(raw as QuestionUnitManifest);
  if (errors.length) throw new Error(`Invalid unit manifest: ${errors.join("; ")}`);
  return raw as QuestionUnitManifest;
}

function assertValid(m: QuestionUnitManifest): void {
  const errors = validateUnitManifest(m);
  if (errors.length) throw new Error(`Invalid unit manifest: ${errors.join("; ")}`);
}

/** Downstream stages (excluding `stage` itself) in topological order. */
export function downstreamOf(stage: UnitStageId): UnitStageId[] {
  const affected = new Set<UnitStageId>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of unitStages) {
      if (s === stage || affected.has(s)) continue;
      if (unitDependencies[s].some((d) => d === stage || affected.has(d))) {
        affected.add(s);
        grew = true;
      }
    }
  }
  return unitStages.filter((s) => affected.has(s));
}

/**
 * Return a new manifest where `stage` and everything downstream of it are
 * marked stale (R-selective-invalidation). Upstream and sibling branches
 * keep their state and revisions, so unchanged work is never rebuilt.
 */
export function invalidateFrom(m: QuestionUnitManifest, stage: UnitStageId): QuestionUnitManifest {
  assertValid(m);
  const stale = new Set<UnitStageId>([stage, ...downstreamOf(stage)]);
  return {
    ...m,
    contentRevision: null,
    stages: m.stages.map((rec) =>
      stale.has(rec.stage) && rec.state !== "blocked"
        ? { ...rec, state: "stale" as const, outputRevision: null }
        : { ...rec },
    ),
  };
}

export interface UnitPlan {
  questionId: string;
  runnable: UnitStageId[];
  blocked: { stage: UnitStageId; waitingOn: UnitStageId[] }[];
  done: UnitStageId[];
  deliverable: boolean;
  blockers: string[];
}

/** Next work for one question: runnable stages in order, plus blockers. */
export function planUnitWork(m: QuestionUnitManifest): UnitPlan {
  assertValid(m);
  const byStage = new Map(m.stages.map((r) => [r.stage, r]));
  const done = unitStages.filter((s) => byStage.get(s)?.state === "done");
  const doneSet = new Set(done);
  const runnable: UnitStageId[] = [];
  const blocked: UnitPlan["blocked"] = [];
  for (const stage of unitStages) {
    const rec = byStage.get(stage);
    if (!rec || rec.state === "done") continue;
    if (rec.state === "blocked") {
      blocked.push({ stage, waitingOn: unitDependencies[stage].filter((d) => !doneSet.has(d)) });
      continue;
    }
    const waitingOn = unitDependencies[stage].filter((d) => !doneSet.has(d));
    if (waitingOn.length === 0) runnable.push(stage);
    else blocked.push({ stage, waitingOn });
  }
  // Deliverable only when the whole dependency closure is current: every
  // stage done. A stale/pending ancestor blocks delivery even if the layout
  // record still says done; unresolved items alone do not block (residual
  // uncertainty is reported, not silently resolved or treated as failure).
  const blockers: string[] = [];
  for (const stage of unitStages) {
    const rec = byStage.get(stage);
    if (rec?.state === "blocked") blockers.push(`${stage} is blocked`);
    else if (rec?.state !== "done") blockers.push(`${stage} is not done (${rec?.state ?? "missing"})`);
  }
  return {
    questionId: m.questionId,
    runnable,
    blocked,
    done,
    deliverable: blockers.length === 0,
    blockers,
  };
}

/** All unresolved items of a unit, grouped by stage (per-question ledger). */
export function unitUnresolvedLedger(m: QuestionUnitManifest): { stage: UnitStageId; items: string[] }[] {
  assertValid(m);
  return m.stages
    .filter((r) => r.unresolved.length > 0)
    .map((r) => ({ stage: r.stage, items: [...r.unresolved] }));
}

export interface AssemblyPlan {
  sourceSha256: string;
  questionIds: string[];
  ready: string[];
  notReady: { questionId: string; blockers: string[] }[];
  assemblyStages: readonly AssemblyStageId[];
}

/**
 * Compose selected units into one document plan. Units must share one
 * source hash and be unique; order follows logicalOrder, not request order.
 * Assembly never mutates unit content (page-layout invariant).
 */
export function planAssembly(manifests: readonly QuestionUnitManifest[]): AssemblyPlan {
  if (manifests.length === 0) throw new Error("planAssembly requires at least one unit");
  for (const m of manifests) assertValid(m);
  const hashes = new Set(manifests.map((m) => m.source.sourceSha256));
  if (hashes.size !== 1) throw new Error("All units in one assembly must share the same sourceSha256");
  const ids = manifests.map((m) => m.questionId);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate questionId in assembly");
  const ordered = [...manifests].sort((a, b) => a.source.logicalOrder - b.source.logicalOrder);
  const ready: string[] = [];
  const notReady: AssemblyPlan["notReady"] = [];
  for (const m of ordered) {
    const plan = planUnitWork(m);
    if (plan.deliverable) ready.push(m.questionId);
    else notReady.push({ questionId: m.questionId, blockers: plan.blockers });
  }
  return {
    sourceSha256: [...hashes][0],
    questionIds: ordered.map((m) => m.questionId),
    ready,
    notReady,
    assemblyStages,
  };
}
