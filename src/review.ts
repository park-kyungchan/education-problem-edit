/** Executable HITL policy. No file I/O, provider calls or user authentication. */
import { createHash } from "node:crypto";
import { decodeUnitManifest, planAssembly, planUnitWork, unitStages, type QuestionUnitManifest, type UnitStageId } from "./question";

export type ReviewKind = "pilot" | "final";
export interface ReviewIssue {
  id: string;
  questionId: string;
  stage: UnitStageId;
  item: string;
  location: string;
  impact: "source-meaning" | "presentation";
  evidence: string;
  conflictsWithDecision: boolean;
}
export interface IssueResolution {
  issueId: string;
  disposition: "reading" | "authorized-residual" | "presentation-choice" | "hold";
  actor: "user" | "agent";
  instruction: string;
}
export interface ArtifactPin {
  role: "document" | "comparison" | "verification";
  path: string;
  sha256: string;
  url: string | null;
}
export interface ReviewCandidate {
  kind: ReviewKind;
  inputDigest: string;
  artifacts: ArtifactPin[];
  nativeStatus: "passed" | "unknown";
  revision: string;
}
export interface ReviewDecision {
  revision: string;
  decision: "accept" | "revise" | "hold";
  actor: "user";
  instruction: string;
}
export interface ReviewOperation {
  schema: "problem-edit.review.v1";
  operationId: string;
  sourceSha256: string;
  questionIds: string[];
  pilotQuestionIds: string[];
  issues: ReviewIssue[];
  resolutions: IssueResolution[];
  candidates: ReviewCandidate[];
  decisions: ReviewDecision[];
}

const hashPattern = /^[a-f0-9]{64}$/;
function need(ok: unknown, code: string): asserts ok {
  if (!ok) throw new Error(`review_${code}@src/review.ts:1`);
}
function object(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === "object" && !Array.isArray(v); }
function text(v: unknown): v is string { return typeof v === "string" && v.trim().length > 0 && v.isWellFormed(); }
function hash(v: unknown): v is string { return typeof v === "string" && hashPattern.test(v); }
function one(v: unknown, values: readonly string[]): boolean { return typeof v === "string" && values.includes(v); }
function strings(v: unknown): v is string[] { return Array.isArray(v) && v.every(text); }
function unique(v: string[]): boolean { return new Set(v).size === v.length; }
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (object(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export function reviewDigest(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
export function needsInterview(issue: ReviewIssue): boolean {
  return issue.impact === "source-meaning" || issue.conflictsWithDecision;
}
function latestResolution(op: ReviewOperation, id: string): IssueResolution | undefined {
  return op.resolutions.findLast(r => r.issueId === id);
}
function latestCandidate(op: ReviewOperation, kind: ReviewKind): ReviewCandidate | undefined {
  return op.candidates.findLast(c => c.kind === kind);
}
function latestDecision(op: ReviewOperation, revision: string): ReviewDecision | undefined {
  return op.decisions.findLast(d => d.revision === revision);
}
function scope(op: ReviewOperation, kind: ReviewKind): string[] {
  return kind === "pilot" ? op.pilotQuestionIds : op.questionIds;
}
function candidateRevision(c: Omit<ReviewCandidate, "revision">): string { return reviewDigest(c); }

/** Reject malformed JSON before any planning, event append or artifact read. */
export function decodeReviewOperation(raw: unknown): ReviewOperation {
  need(object(raw) && raw.schema === "problem-edit.review.v1", "schema");
  need(text(raw.operationId) && hash(raw.sourceSha256), "identity");
  need(strings(raw.questionIds) && raw.questionIds.length > 0 && unique(raw.questionIds), "question_ids");
  need(raw.questionIds.every(q => /^Q[1-9][0-9]{0,2}$/.test(q)), "canonical_ids");
  need(strings(raw.pilotQuestionIds) && unique(raw.pilotQuestionIds), "pilot_ids");
  need(raw.pilotQuestionIds.length >= Math.min(2, raw.questionIds.length) && raw.pilotQuestionIds.length <= 3 && raw.pilotQuestionIds.every(q => (raw.questionIds as string[]).includes(q)), "pilot_coverage");
  need(Array.isArray(raw.issues) && Array.isArray(raw.resolutions) && Array.isArray(raw.candidates) && Array.isArray(raw.decisions), "collections");
  const ids = new Set<string>();
  for (const i of raw.issues) {
    need(object(i) && text(i.id) && !ids.has(i.id), "issue_id"); ids.add(i.id);
    need(typeof i.questionId === "string" && raw.questionIds.includes(i.questionId) && one(i.stage, unitStages), "issue_scope");
    need(text(i.item) && text(i.location) && text(i.evidence) && one(i.impact, ["source-meaning", "presentation"]) && typeof i.conflictsWithDecision === "boolean", "issue_evidence");
  }
  for (const r of raw.resolutions) {
    need(object(r) && typeof r.issueId === "string" && ids.has(r.issueId) && text(r.instruction), "resolution");
    need(one(r.actor, ["user", "agent"]) && one(r.disposition, ["reading", "authorized-residual", "presentation-choice", "hold"]), "resolution_kind");
    const i = (raw.issues as unknown as ReviewIssue[]).find(i => i.id === r.issueId)!;
    need(r.actor === "user" || (!needsInterview(i) && r.disposition === "presentation-choice"), "human_resolution_required");
    need(r.disposition !== "presentation-choice" || !needsInterview(i), "source_is_not_presentation");
  }
  for (const c of raw.candidates) {
    need(object(c) && one(c.kind, ["pilot", "final"]) && hash(c.inputDigest) && hash(c.revision) && one(c.nativeStatus, ["passed", "unknown"]), "candidate");
    need(Array.isArray(c.artifacts) && c.artifacts.length === 3, "candidate_artifacts");
    for (const a of c.artifacts) {
      need(object(a) && one(a.role, ["document", "comparison", "verification"]) && text(a.path) && hash(a.sha256), "artifact_pin");
      need(a.url === null || (text(a.url) && /^https:\/\//.test(a.url)), "artifact_url");
      if (a.role !== "verification") need(text(a.url), "accessible_review_required");
      if (a.role === "document") need(/\.hwpx$/i.test(a.path), "hwpx_required");
    }
    need(unique(c.artifacts.map(a => a.role)), "artifact_roles");
    const { revision, ...body } = c;
    need(candidateRevision(body as unknown as Omit<ReviewCandidate, "revision">) === revision, "candidate_digest");
  }
  const revisions = new Set(raw.candidates.map(c => c.revision));
  for (const d of raw.decisions) {
    need(object(d) && typeof d.revision === "string" && revisions.has(d.revision) && one(d.decision, ["accept", "revise", "hold"]) && d.actor === "user" && text(d.instruction), "decision");
  }
  return raw as unknown as ReviewOperation;
}

function checkedUnits(op: ReviewOperation, units: readonly QuestionUnitManifest[]): QuestionUnitManifest[] {
  units.forEach(decodeUnitManifest);
  const assembly = planAssembly(units);
  need(assembly.sourceSha256 === op.sourceSha256, "source_changed");
  need(reviewDigest(assembly.questionIds) === reviewDigest(op.questionIds), "selection_changed");
  return assembly.questionIds.map(q => units.find(u => u.questionId === q)!);
}
export function createReviewOperation(operationId: string, units: readonly QuestionUnitManifest[], pilotQuestionIds: string[]): ReviewOperation {
  const assembly = planAssembly(units);
  return decodeReviewOperation({ schema: "problem-edit.review.v1", operationId, sourceSha256: assembly.sourceSha256,
    questionIds: assembly.questionIds, pilotQuestionIds, issues: [], resolutions: [], candidates: [], decisions: [] });
}
function inputDigest(op: ReviewOperation, kind: ReviewKind, units: readonly QuestionUnitManifest[]): string {
  const ids = scope(op, kind);
  return reviewDigest({ operationId: op.operationId, source: op.sourceSha256, selection: op.questionIds, pilot: op.pilotQuestionIds,
    // Include only the relevant questions. A correction elsewhere preserves pilot approval.
    units: units.filter(u => ids.includes(u.questionId)).map(u => ({ questionId: u.questionId, source: u.source, stages: u.stages, contentRevision: u.contentRevision })),
    issues: op.issues.filter(i => ids.includes(i.questionId)).map(i => ({ issue: i, resolution: latestResolution(op, i.id) ?? null })),
    pilotRevision: kind === "final" ? latestCandidate(op, "pilot")?.revision ?? null : null });
}
function contentBlockers(op: ReviewOperation, kind: ReviewKind, units: readonly QuestionUnitManifest[]): string[] {
  const ids = scope(op, kind);
  const blockers: string[] = [];
  for (const u of units.filter(u => ids.includes(u.questionId))) {
    blockers.push(...planUnitWork(u).blockers.map(b => `${u.questionId}: ${b}`));
    if (!text(u.contentRevision)) blockers.push(`${u.questionId}: missing content revision`);
    for (const s of u.stages) for (const item of s.unresolved) {
      if (!op.issues.some(i => i.questionId === u.questionId && i.stage === s.stage && i.item === item)) blockers.push(`${u.questionId}/${s.stage}: unregistered unresolved item`);
    }
  }
  for (const i of op.issues.filter(i => ids.includes(i.questionId))) {
    const resolution = latestResolution(op, i.id);
    if (!resolution || resolution.disposition === "hold") blockers.push(`${i.id}: ${needsInterview(i) ? "interview required" : "presentation decision required"}`);
  }
  return blockers;
}
export interface ReviewPlan {
  pilot: { revision: string | null; accepted: boolean; blockers: string[] };
  final: { revision: string | null; accepted: boolean; blockers: string[] };
  scaleReady: boolean;
  deliveryReady: boolean;
  nativeVerified: boolean;
  residuals: { issue: ReviewIssue; resolution: IssueResolution }[];
}
/** Pins verified by the file adapter are passed as hashes; missing bytes fail closed. */
export function planReview(op: ReviewOperation, units: readonly QuestionUnitManifest[], observed: Readonly<Record<string, string>>): ReviewPlan {
  decodeReviewOperation(op);
  const ordered = checkedUnits(op, units);
  const evaluate = (kind: ReviewKind) => {
    const c = latestCandidate(op, kind);
    const blockers = contentBlockers(op, kind, ordered);
    if (!c) blockers.push("candidate required");
    else {
      if (c.inputDigest !== inputDigest(op, kind, ordered)) blockers.push("candidate inputs changed");
      for (const a of c.artifacts) if (observed[a.path] !== a.sha256) blockers.push(`${a.role}: artifact missing or changed`);
      const d = latestDecision(op, c.revision);
      if (d?.decision !== "accept") blockers.push(d ? `user decision: ${d.decision}` : "user approval required");
    }
    return { revision: c?.revision ?? null, accepted: blockers.length === 0, blockers };
  };
  const pilot = evaluate("pilot");
  const final = evaluate("final");
  if (!pilot.accepted) { final.blockers.push("pilot approval required"); final.accepted = false; }
  return { pilot, final, scaleReady: pilot.accepted, deliveryReady: final.accepted,
    nativeVerified: final.accepted && latestCandidate(op, "final")?.nativeStatus === "passed",
    residuals: op.issues.flatMap(issue => { const resolution = latestResolution(op, issue.id); return resolution?.disposition === "authorized-residual" ? [{ issue, resolution }] : []; }) };
}
export function addReviewIssue(op: ReviewOperation, issue: ReviewIssue): ReviewOperation {
  decodeReviewOperation(op);
  return decodeReviewOperation({ ...op, issues: [...op.issues, issue] });
}
export function resolveReviewIssue(op: ReviewOperation, resolution: IssueResolution): ReviewOperation {
  decodeReviewOperation(op);
  return decodeReviewOperation({ ...op, resolutions: [...op.resolutions, resolution] });
}
/** Append a new immutable candidate; never overwrite prior approvals/history. */
export function proposeReviewCandidate(op: ReviewOperation, kind: ReviewKind, units: readonly QuestionUnitManifest[], artifacts: ArtifactPin[], nativeStatus: ReviewCandidate["nativeStatus"], observed: Readonly<Record<string, string>>): ReviewOperation {
  decodeReviewOperation(op); need(one(kind, ["pilot", "final"]), "kind");
  const ordered = checkedUnits(op, units);
  need(contentBlockers(op, kind, ordered).length === 0, "content_blocked");
  if (kind === "final") need(planReview(op, units, observed).scaleReady, "pilot_required_before_final");
  need(artifacts.every(a => observed[a.path] === a.sha256), "artifact_readback");
  const body = { kind, inputDigest: inputDigest(op, kind, ordered), artifacts, nativeStatus };
  return decodeReviewOperation({ ...op, candidates: [...op.candidates, { ...body, revision: candidateRevision(body) }] });
}
export function recordReviewDecision(op: ReviewOperation, decision: ReviewDecision, units: readonly QuestionUnitManifest[], observed: Readonly<Record<string, string>>): ReviewOperation {
  decodeReviewOperation(op);
  need(object(decision), "decision");
  const c = op.candidates.find(c => c.revision === decision.revision);
  need(c && latestCandidate(op, c.kind)?.revision === c.revision, "stale_decision_target");
  if (decision.decision === "accept") {
    const ordered = checkedUnits(op, units);
    need(c.inputDigest === inputDigest(op, c.kind, ordered) && contentBlockers(op, c.kind, ordered).length === 0, "stale_approval_inputs");
    need(c.artifacts.every(a => observed[a.path] === a.sha256), "stale_approval_artifact");
    if (c.kind === "final") need(planReview(op, units, observed).scaleReady, "pilot_required_before_final");
  }
  return decodeReviewOperation({ ...op, decisions: [...op.decisions, decision] });
}
