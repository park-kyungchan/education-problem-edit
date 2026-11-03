import { createHash } from "node:crypto";
import { isDeepStrictEqual as equal } from "node:util";

export const ADAPTER_VERSION = "qualification-v1";
export const EVALUATOR_SHA256 = "78589ea7157a3b24ae99dcebafee75ca0a6d6893620f798d85f5da01d6ab6f86";
export const FINAL_CRITICAL = ["source-identity", "source-facts", "unknowns-preserved", "editable-objects", "topology", "geometry", "operation-boundary", "original-comparison"] as const;
const stages = ["research", "vision", "synthesis", "review"] as const;
export type Stage = typeof stages[number];
export type Family = "researchRouting" | "visionBox" | "codePreviewReview" | "endToEnd";
type Obj = Record<string, any>;
const obj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 16000;
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);
const nullableNumber = (v: unknown) => v === null || (finite(v) && v >= 0);
const keys = (v: unknown, required: readonly string[], optional: readonly string[] = []) => obj(v) && required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => [...required, ...optional].includes(k));
export const digestText = (s: string) => createHash("sha256").update(s).digest("hex");
export const digestResult = (v: unknown) => digestText(JSON.stringify(v));
const freeze = <T>(v: T): T => { if (obj(v) || Array.isArray(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };

export interface EvaluationBinding { caseId: string; armId: string; occurrenceId: string; packetSha256: string; resultSha256: string }
export interface OwnerEvaluationContext {
  version: typeof ADAPTER_VERSION; evaluatorSha256: string; family: Family;
  expected: EvaluationBinding; captured: EvaluationBinding;
  claimScope: "stageDiagnostic" | "artifactOnly" | "counterfactualArtifact" | "observedCumulative";
  reviewBinding?: EvaluationBinding;
  finalReceiptSha256?: string;
}
type Disposition = "qualified" | "failed" | "held" | "notApplicable";
const adapted = Symbol("validated-adapter-result");
export interface AdaptedEvaluation {
  readonly [adapted]: true; readonly raw: Obj; readonly context: OwnerEvaluationContext;
  readonly artifactQuality: Disposition; readonly stageDiagnostic: "usable" | "failed" | "held" | "notApplicable";
  readonly reasons: readonly string[];
}
const bindingValid = (v: unknown): v is EvaluationBinding => keys(v, ["caseId", "armId", "occurrenceId", "packetSha256", "resultSha256"]) && [(v as Obj).caseId, (v as Obj).armId, (v as Obj).occurrenceId].every(text) && hash((v as Obj).packetSha256) && hash((v as Obj).resultSha256);
const anchorKeys: Record<string, string[]> = {
  researchRouting: ["evidenceSupport", "coverage", "usefulRouteSelection", "uncertaintyHandling"],
  visionBox: ["targetCoverageAndNoClipping", "correctTarget", "absenceAndAmbiguityHandling"],
  codePreviewReview: ["severityWeightedDefectRecall", "falseClearAvoidance", "revisionBoundaryRespect", "usefulEscalation"],
  endToEnd: ["sourceContentFidelity", "mathematicalTopology", "codeEditControl", "previewReadability", "traceability"]
};
// Owner context is loaded outside model output. Hash binding is evidence, not actor authentication.
export function adaptFrozenEvaluation(raw: unknown, context: OwnerEvaluationContext): AdaptedEvaluation {
  let artifactQuality: Disposition = "held", stageDiagnostic: AdaptedEvaluation["stageDiagnostic"] = "held";
  const reasons: string[] = [];
  let r: Obj = {}, c = context;
  try { r = JSON.parse(JSON.stringify(raw)); c = structuredClone(context); } catch { reasons.push("invalid-capture"); }
  const done = (): AdaptedEvaluation => freeze({ [adapted]: true as const, raw: r, context: c, artifactQuality, stageDiagnostic, reasons });
  if (!obj(r) || !obj(c) || c.version !== ADAPTER_VERSION || c.evaluatorSha256 !== EVALUATOR_SHA256 || !Object.hasOwn(anchorKeys, c.family) ||
      !bindingValid(c.expected) || !bindingValid(c.captured) || !equal(c.expected, c.captured) || digestResult(r) !== c.expected.resultSha256 ||
      !["stageDiagnostic", "artifactOnly", "counterfactualArtifact", "observedCumulative"].includes(c.claimScope) ||
      (c.family === "endToEnd") === (c.claimScope === "stageDiagnostic")) {
    reasons.push("unsupported-or-unbound-capture"); return done();
  }
  if (c.family !== "endToEnd") {
    artifactQuality = "notApplicable";
    if (r.status === "invalid") { reasons.push("invalid-stage"); return done(); }
    if (!keys(r, ["status", "score", "denominator", "anchors", "applicable", "metrics", "criticalFailures", "confidence", "requiresReview", "stageQualification"]) ||
        r.status !== "scored-stage-diagnostic" || !nullableNumber(r.score) || (r.score !== null && r.score > 100) || !finite(r.denominator) || r.denominator <= 0 ||
        !keys(r.anchors, anchorKeys[c.family]) || !Object.values(r.anchors).every(v => v === null || finite(v) && v >= 0 && v <= 1) || !strings(r.applicable) ||
        new Set(r.applicable).size !== r.applicable.length || !r.applicable.length || r.applicable.some((k: string) => !anchorKeys[c.family].includes(k)) ||
        !obj(r.metrics) || !strings(r.criticalFailures) || typeof r.requiresReview !== "boolean" || r.stageQualification !== null) {
      reasons.push("unsupported-stage-shape"); return done();
    }
    const m = r.metrics;
    if (c.family === "researchRouting" && (!Number.isSafeInteger(m.correctClaims) || !Number.isSafeInteger(m.totalClaims) || m.totalClaims <= 0 || m.correctClaims < 0 || m.correctClaims > m.totalClaims) ||
        c.family === "visionBox" && typeof m.localizationTruthKnown !== "boolean" ||
        c.family === "codePreviewReview" && (!nullableNumber(m.severityRecallDenominator) || !nullableNumber(m.severityRecall) || !strings(m.falseAlarmIds))) {
      reasons.push("unsupported-stage-metrics"); return done();
    }
    if (c.family === "codePreviewReview") {
      if (m.criticalSourceJudgementCorrect === false || m.criticalDefectsDetected === false) { stageDiagnostic = "failed"; reasons.push("critical-review-failed"); return done(); }
      if (m.criticalSourceJudgementCorrect !== true || m.criticalDefectsDetected !== true) { reasons.push("critical-review-unknown"); return done(); }
    }
    if (r.criticalFailures.length) { stageDiagnostic = "failed"; reasons.push("critical-stage-failed"); }
    else if (r.score === null || !finite(r.confidence) || r.confidence < 0 || r.confidence > 1 || r.requiresReview || r.applicable.some((k: string) => r.anchors[k] === null)) reasons.push("stage-review-required");
    else stageDiagnostic = "usable"; // No stage soft-score floor or parity requirement.
    return done();
  }
  stageDiagnostic = "notApplicable";
  if (Array.isArray(r.errors) && r.errors.length) { reasons.push("invalid-final-artifact"); return done(); }
  if (!keys(r, ["verdict", "score", "critical", "components", "lineage", "sourceAcceptance"]) ||
      !["qualified", "failed", "held"].includes(r.verdict) || !keys(r.critical, FINAL_CRITICAL) ||
      !Object.values(r.critical).every(v => v === null || typeof v === "boolean") ||
      !keys(r.components, ["score", "denominator", "anchors"]) || r.components.score !== r.score || !finite(r.components.denominator) || r.components.denominator <= 0 ||
      !keys(r.components.anchors, anchorKeys.endToEnd) || !Object.values(r.components.anchors).every(v => v === null || finite(v) && v >= 0 && v <= 1) ||
      r.sourceAcceptance !== null || !nullableNumber(r.score) || r.score !== null && r.score > 100) { reasons.push("unsupported-final-shape"); return done(); }
  if (r.score === null || Object.values(r.critical).includes(null) || Object.values(r.components.anchors).includes(null)) reasons.push("final-critical-unknown");
  else if (r.score < 75 || !Object.values(r.critical).every(v => v === true)) { artifactQuality = "failed"; reasons.push("final-quality-failed"); }
  else if (r.verdict !== "qualified") reasons.push("inconsistent-final-verdict");
  else artifactQuality = "qualified";
  return done();
}

export interface StepReceipt {
  stage: Stage; mode: "actualFresh" | "actualCapturedReuse" | "counterfactualOffline" | "missing";
  inputSha256: string | null; outputSha256: string | null; actualOccurrenceId: string | null;
  reusedInputSha256?: string; reusedOutputSha256?: string;
}
export interface ClaimEvidence {
  receipt: { comparisonSourceSha256: string; rejectedOperationIds: string[]; claimedObservedCumulative: boolean; lineage: readonly StepReceipt[] };
  declarations: OwnerOccurrenceDeclarations; requests: readonly ActualRequestReceipt[];
  presentationRepairs?: readonly PresentationRepair[];
  review: AdaptedEvaluation;
}
export function qualify(evaluation: AdaptedEvaluation, evidence?: ClaimEvidence) {
  const reasons = [...evaluation.reasons];
  let observedWorkflow: "eligible" | "ineligible" | "held" | "notClaimed" = "notClaimed";
  if (!evaluation[adapted]) throw Error("ADAPTER_RESULT_REQUIRED");
  if (evaluation.context?.claimScope === "observedCumulative") {
    observedWorkflow = "held";
    const l = evaluation.raw.lineage, c = evaluation.context;
    if (evaluation.artifactQuality !== "qualified") reasons.push("artifact-not-qualified");
    else if (!keys(l, ["observedCumulative", "counterfactual", "claimValid", "complete"]) || l.observedCumulative !== true || l.claimValid !== true || l.complete !== true || l.counterfactual !== false) reasons.push("observed-lineage-invalid");
    else if (!evidence || !keys(evidence.receipt, ["comparisonSourceSha256", "rejectedOperationIds", "claimedObservedCumulative", "lineage"]) || !hash(evidence.receipt.comparisonSourceSha256) || !strings(evidence.receipt.rejectedOperationIds) ||
      !obj(evidence.declarations) || !Array.isArray(evidence.declarations.slots) || !Array.isArray(evidence.declarations.occurrences) || !Array.isArray(evidence.requests) ||
      !hash(c.finalReceiptSha256) || digestResult(evidence.receipt) !== c.finalReceiptSha256 || evidence.receipt.claimedObservedCumulative !== true || !Array.isArray(evidence.receipt.lineage) || evidence.receipt.lineage.length !== 4 ||
      stages.some(s => evidence.receipt.lineage.filter(t => t?.stage === s).length !== 1)) reasons.push("missing-observed-evidence");
    else {
      const accounting = accountRequests(evidence.requests, evidence.declarations, evidence.presentationRepairs);
      const review = evidence.review;
      let valid = accounting.eligible && bindingValid(c.reviewBinding) && !!review?.[adapted] && review.context.family === "codePreviewReview" && review.stageDiagnostic === "usable" && equal(review.context.expected, c.reviewBinding);
      for (const step of evidence.receipt.lineage) {
        const request = evidence.requests.find(r => r.occurrenceId === step.actualOccurrenceId);
        const slot = evidence.declarations.slots.find(s => s.id === request?.slotId);
        const occurrence = evidence.declarations.occurrences.find(o => o.id === slot?.occurrenceId);
        const sameOccurrence = occurrence?.caseId === c.expected.caseId && occurrence?.armId === c.expected.armId && occurrence?.id === c.expected.occurrenceId;
        const authorizedReuse = step.mode === "actualCapturedReuse" && evidence.declarations.reuse?.some(edge => edge.targetOccurrenceId === c.expected.occurrenceId && edge.stage === step.stage && edge.actualRequestId === request?.actualRequestId && edge.inputSha256 === step.inputSha256 && edge.outputSha256 === step.outputSha256);
        const target = evidence.declarations.occurrences.find(o => o.id === c.expected.occurrenceId);
        const repairedOutput = step.mode === "actualFresh" && evidence.presentationRepairs?.some(p => p.parentActualRequestId === request?.actualRequestId && digestText(p.outputText) === step.outputSha256);
        valid &&= keys(step, ["stage", "mode", "inputSha256", "outputSha256", "actualOccurrenceId"], ["reusedInputSha256", "reusedOutputSha256"]) && !!request && !!slot && !!occurrence && target?.caseId === c.expected.caseId && target?.armId === c.expected.armId && request.status === "completed" && slot.stage === step.stage && (sameOccurrence || authorizedReuse === true) &&
          hash(step.inputSha256) && hash(step.outputSha256) && request.requestSha256 === step.inputSha256 && (request.outputSha256 === step.outputSha256 || repairedOutput === true) &&
          (step.mode === "actualFresh" || step.mode === "actualCapturedReuse" && step.reusedInputSha256 === step.inputSha256 && step.reusedOutputSha256 === step.outputSha256);
      }
      const reviewStep = evidence.receipt.lineage.find(s => s.stage === "review");
      const reviewRequest = accounting.unique.find(r => r.occurrenceId === reviewStep?.actualOccurrenceId);
      const reviewSlot = evidence.declarations.slots.find(s => s.id === reviewRequest?.slotId);
      const reviewOwner = evidence.declarations.occurrences.find(o => o.id === reviewSlot?.occurrenceId);
      const sources = evidence.declarations.reviewSources;
      const source = Array.isArray(sources) ? sources.find(s => s?.actualRequestId === reviewRequest?.actualRequestId) : undefined;
      // Source request identity is retained for captured reuse; workflow IDs/packets may differ.
      const sourceJoined = bindingValid(c.reviewBinding) && !!reviewRequest && !!reviewOwner && reviewSlot?.stage === "review" &&
        reviewStep?.actualOccurrenceId === c.reviewBinding.occurrenceId && reviewRequest.caseId === c.reviewBinding.caseId && reviewRequest.armId === c.reviewBinding.armId &&
        reviewOwner.caseId === c.reviewBinding.caseId && reviewOwner.armId === c.reviewBinding.armId &&
        Array.isArray(sources) && sources.filter(s => s?.actualRequestId === reviewRequest.actualRequestId).length === 1 &&
        !!source && keys(source, ["actualRequestId", "requestSha256", "outputSha256", "packetSha256", "comparisonSourceSha256", "resultSha256"]) &&
        [source.requestSha256, source.outputSha256, source.packetSha256, source.comparisonSourceSha256, source.resultSha256].every(hash) &&
        source.requestSha256 === reviewRequest.requestSha256 && source.outputSha256 === reviewRequest.outputSha256 &&
        source.packetSha256 === c.reviewBinding.packetSha256 && source.resultSha256 === c.reviewBinding.resultSha256 &&
        source.comparisonSourceSha256 === evidence.receipt.comparisonSourceSha256;
      valid &&= sourceJoined;
      if (!sourceJoined) reasons.push("unbound-reviewed-source");
      if (valid) observedWorkflow = "eligible";
      else { observedWorkflow = "ineligible"; reasons.push("unbound-observed-request-or-review"); }
    }
  }
  return { artifactQuality: evaluation.artifactQuality, stageDiagnostic: evaluation.stageDiagnostic, observedWorkflow,
    // A single-arm guard cannot establish a comparable-arm savings claim.
    savingsClaim: observedWorkflow === "notClaimed" ? "notClaimed" as const : "held" as const,
    reasons, wholeSessionSavingsEstablished: false, nativeUsd: null, sourceAcceptance: null, acceptanceDecision: null };
}

export interface OwnerOccurrence { id: string; caseId: string; armId: string; scope: "stagePair" | "workflow"; split: "heldout" | "calibration" }
export interface RequestSlot { id: string; occurrenceId: string; stage: Stage; initialParentSlotId: string | null }
export interface CapturedReuseEdge { targetOccurrenceId: string; stage: Stage; actualRequestId: string; inputSha256: string; outputSha256: string }
// Owner-authored association of the captured request/output with its frozen source evaluation.
export interface ReviewSourceBinding { actualRequestId: string; requestSha256: string; outputSha256: string; packetSha256: string; comparisonSourceSha256: string; resultSha256: string }
export interface OwnerOccurrenceDeclarations {
  occurrences: readonly OwnerOccurrence[]; slots: readonly RequestSlot[];
  historyComplete: boolean; knownActualRequestIds: readonly string[]; knownPresentationRepairIds: readonly string[];
  reuse?: readonly CapturedReuseEdge[];
  reviewSources?: readonly ReviewSourceBinding[];
}
interface RequestBinding { caseId: string; armId: string; slotId: string; kind: "nativeApplicationCli" | "jevHttp"; purpose: "initial" | "correction" | "refinement"; parentActualRequestId: string | null; requestSha256: string }
export interface ActualRequestReceipt extends RequestBinding {
  actualRequestId: string; occurrenceId: string; outputSha256: string | null;
  status: "completed" | "failed" | "uncertain"; nativeCliInvocationId: string | null;
  providerAttempts: number | null; providerAttemptsEvidenceRef: string | null;
  usage: {input: number | null; cachedInput: number | null; uncachedInput: number | null; output: number | null};
  wallMs: number | null; activeMs: number | null; jevUsd: string | null; uncertainLiabilityMicroUsd: number | null;
}
export interface PlannedRequest extends RequestBinding { proposalId: string }
export interface PresentationRepair { repairId: string; slotId: string; parentActualRequestId: string; operation: "canonical-json" | "strip-json-fence"; inputText: string; outputText: string }
const requestKeys = ["caseId", "armId", "slotId", "kind", "purpose", "parentActualRequestId", "requestSha256", "actualRequestId", "occurrenceId", "outputSha256", "status", "nativeCliInvocationId", "providerAttempts", "providerAttemptsEvidenceRef", "usage", "wallMs", "activeMs", "jevUsd", "uncertainLiabilityMicroUsd"];

function evaluateRequests(receipts: readonly ActualRequestReceipt[], owner: OwnerOccurrenceDeclarations, repairs: readonly PresentationRepair[], next?: PlannedRequest) {
  const errors: string[] = [], unique: ActualRequestReceipt[] = [];
  const counts = {jevSentHttpRequests: 0, nativeApplicationCliInvocations: 0, jevRefinements: 0, nativeExtra: 0};
  const byActual = new Map<string, ActualRequestReceipt>(), byOccurrence = new Map<string, string>(), byNative = new Map<string, string>();
  const per = new Map<string, {corrections: number; refinements: number; initials: number; repairs: number}>();
  const group = (id: string) => { if (!per.has(id)) per.set(id, {corrections: 0, refinements: 0, initials: 0, repairs: 0}); return per.get(id)!; };
  if (!obj(owner) || !Array.isArray(owner.occurrences) || !Array.isArray(owner.slots) || !owner.occurrences.every(obj) || !owner.slots.every(obj) || !Array.isArray(receipts) || !Array.isArray(repairs)) return {eligible: false, errors: ["invalid-accounting-input"], counts, projectedCounts: null, unique, rawReceipts: receipts, countsComplete: false, providerAttempts: null, nativeUsd: null, wholeSessionSavingsEstablished: false};
  const occurrences = new Map(owner.occurrences.map(o => [o.id, o])), slots = new Map(owner.slots.map(s => [s.id, s]));
  if (occurrences.size !== owner.occurrences.length || slots.size !== owner.slots.length || owner.occurrences.some(o => !keys(o, ["id", "caseId", "armId", "scope", "split"]) || ![o.id, o.caseId, o.armId].every(text) || !["stagePair", "workflow"].includes(o.scope) || !["heldout", "calibration"].includes(o.split)) ||
      owner.slots.some(s => !keys(s, ["id", "occurrenceId", "stage", "initialParentSlotId"]) || !text(s.id) || !occurrences.has(s.occurrenceId) || !stages.includes(s.stage) || s.initialParentSlotId !== null && !slots.has(s.initialParentSlotId)) ||
      new Set(owner.slots.map(s => `${s.occurrenceId}:${s.stage}`)).size !== owner.slots.length ||
      new Set(owner.occurrences.map(o => JSON.stringify([o.caseId, o.armId, o.scope]))).size !== owner.occurrences.length) errors.push("invalid-owner-declarations");
  for (const r of receipts) {
    if (!keys(r, requestKeys) || ![r.actualRequestId, r.occurrenceId].every(text) || !["completed", "failed", "uncertain"].includes(r.status) || !(r.outputSha256 === null || hash(r.outputSha256)) ||
        !keys(r.usage, ["input", "cachedInput", "uncachedInput", "output"]) || !Object.values(r.usage).every(nullableNumber) || !nullableNumber(r.wallMs) || !nullableNumber(r.activeMs) || !nullableNumber(r.uncertainLiabilityMicroUsd) ||
        !(r.jevUsd === null || typeof r.jevUsd === "string" && /^\d+(\.\d+)?$/.test(r.jevUsd)) || !(r.providerAttempts === null || Number.isSafeInteger(r.providerAttempts) && r.providerAttempts >= 0 && text(r.providerAttemptsEvidenceRef)) ||
        (r.kind === "nativeApplicationCli" ? !text(r.nativeCliInvocationId) : r.nativeCliInvocationId !== null)) { errors.push("invalid-actual-receipt"); continue; }
    const prior = byActual.get(r.actualRequestId);
    if (prior) { if (!equal(prior, r)) errors.push("conflicting-actual-request"); continue; }
    if (byOccurrence.has(r.occurrenceId) || r.kind === "nativeApplicationCli" && byNative.has(r.nativeCliInvocationId!)) errors.push("aliased-actual-identity");
    byActual.set(r.actualRequestId, r); byOccurrence.set(r.occurrenceId, r.actualRequestId);
    if (r.kind === "nativeApplicationCli") byNative.set(r.nativeCliInvocationId!, r.actualRequestId);
    unique.push(r);
    if (r.status === "uncertain") errors.push("uncertain-effects-require-reconciliation");
  }
  if (owner.historyComplete !== true || !strings(owner.knownActualRequestIds) && owner.knownActualRequestIds?.length !== 0 || !Array.isArray(owner.knownActualRequestIds) ||
      new Set(owner.knownActualRequestIds).size !== owner.knownActualRequestIds.length || !equal([...byActual.keys()].sort(), [...owner.knownActualRequestIds].sort())) errors.push("incomplete-authoritative-history");
  function consume(r: RequestBinding, totals: typeof counts) {
    const slot = slots.get(r.slotId), occurrence = occurrences.get(slot?.occurrenceId ?? ""), parent = byActual.get(r.parentActualRequestId ?? "");
    const parentSlot = slots.get(parent?.slotId ?? "");
    if (!slot || !occurrence || r.caseId !== occurrence.caseId || r.armId !== occurrence.armId || !hash(r.requestSha256) || !["initial", "correction", "refinement"].includes(r.purpose) || !["nativeApplicationCli", "jevHttp"].includes(r.kind)) { errors.push("request-owner-binding"); return; }
    if (occurrence.split !== "heldout") errors.push("calibration-model-request");
    if (r.kind === "jevHttp") { totals.jevSentHttpRequests++; if (r.purpose === "refinement") totals.jevRefinements++; if (r.purpose === "correction") errors.push("paid-semantic-correction"); }
    else { totals.nativeApplicationCliInvocations++; if (r.purpose !== "initial") totals.nativeExtra++; }
    const slotGroup = group("slot:" + slot.id), allowance = group("occurrence:" + occurrence.id);
    if (r.purpose === "initial") {
      if (++slotGroup.initials > 1) errors.push("repeated-initial-slot");
      if (slot.initialParentSlotId === null ? r.parentActualRequestId !== null : !parent || parentSlot?.id !== slot.initialParentSlotId) errors.push("initial-parent-binding");
    } else {
      if (!parent || parent.slotId !== slot.id || parent.caseId !== r.caseId || parent.armId !== r.armId || !hash(parent.outputSha256) || parent.status === "uncertain") errors.push("extra-parent-binding");
      if (r.purpose === "correction" && ++allowance.corrections > 1) errors.push("per-occurrence-correction-limit");
      if (r.purpose === "refinement" && (slot.stage !== "vision" || ++slotGroup.refinements > 1)) errors.push("per-vision-refinement-limit");
    }
    if (parent && (parent.caseId !== r.caseId || parent.armId !== r.armId || parentSlot?.occurrenceId !== occurrence.id)) errors.push("cross-occurrence-parent");
  }
  for (const r of unique) {
    consume(r, counts);
    const seen = new Set<string>([r.actualRequestId]); let parentId = r.parentActualRequestId;
    while (parentId) { if (seen.has(parentId)) { errors.push("request-parent-cycle"); break; } seen.add(parentId); parentId = byActual.get(parentId)?.parentActualRequestId ?? null; }
  }
  if (owner.reuse !== undefined) {
    if (!Array.isArray(owner.reuse)) errors.push("invalid-captured-reuse");
    else {
      const destinations = new Set<string>();
      for (const edge of owner.reuse) {
        if (!keys(edge, ["targetOccurrenceId", "stage", "actualRequestId", "inputSha256", "outputSha256"])) { errors.push("invalid-captured-reuse"); continue; }
        const request = byActual.get(edge.actualRequestId), slot = slots.get(request?.slotId ?? ""), destination = JSON.stringify([edge.targetOccurrenceId, edge.stage]);
        if (destinations.has(destination) || !owner.slots.some(s => s.occurrenceId === edge.targetOccurrenceId && s.stage === edge.stage) || !request || request.status !== "completed" || slot?.stage !== edge.stage ||
            !hash(edge.inputSha256) || !hash(edge.outputSha256) || request.requestSha256 !== edge.inputSha256 || request.outputSha256 !== edge.outputSha256) errors.push("invalid-captured-reuse");
        destinations.add(destination);
      }
    }
  }
  const repairIds = new Map<string, PresentationRepair>();
  for (const repair of repairs) {
    if (repairIds.has(repair?.repairId)) { if (!equal(repairIds.get(repair.repairId), repair)) errors.push("conflicting-repair"); continue; }
    if (!keys(repair, ["repairId", "slotId", "parentActualRequestId", "operation", "inputText", "outputText"]) || !text(repair.repairId) || typeof repair.inputText !== "string" || typeof repair.outputText !== "string") { errors.push("invalid-presentation-repair"); continue; }
    repairIds.set(repair.repairId, repair);
    const slot = slots.get(repair.slotId), parent = byActual.get(repair.parentActualRequestId);
    if (!slot || !parent || parent.slotId !== slot.id || parent.outputSha256 !== digestText(repair.inputText)) { errors.push("repair-parent-binding"); continue; }
    if (++group("occurrence:" + slot.occurrenceId).repairs > 1) errors.push("presentation-repair-limit");
    try {
      const expected = repair.operation === "canonical-json" ? JSON.stringify(JSON.parse(repair.inputText)) : repair.operation === "strip-json-fence" ? repair.inputText.match(/^```(?:json)?\r?\n([\s\S]*)\r?\n```$/)?.[1] : undefined;
      if (expected === undefined || expected !== repair.outputText) errors.push("non-whitelisted-presentation-repair");
    } catch { errors.push("non-whitelisted-presentation-repair"); }
  }
  if (!Array.isArray(owner.knownPresentationRepairIds) || owner.knownPresentationRepairIds.some(id => !text(id)) || new Set(owner.knownPresentationRepairIds).size !== owner.knownPresentationRepairIds.length ||
      !equal([...repairIds.keys()].sort(), [...owner.knownPresentationRepairIds].sort())) errors.push("incomplete-presentation-repair-history");
  let projectedCounts: typeof counts | null = null;
  if (next) {
    projectedCounts = {...counts};
    if (!keys(next, ["proposalId", "caseId", "armId", "slotId", "kind", "purpose", "parentActualRequestId", "requestSha256"]) || !text(next.proposalId)) errors.push("invalid-next-request");
    else consume(next, projectedCounts);
  }
  const limit = projectedCounts ?? counts;
  if (limit.jevSentHttpRequests > 24 || limit.nativeApplicationCliInvocations > 32 || limit.jevRefinements > 6 || limit.nativeExtra > 6) errors.push("shared-request-or-pool-limit");
  return {eligible: errors.length === 0, errors: [...new Set(errors)], counts, projectedCounts, unique, rawReceipts: receipts,
    countsComplete: errors.length === 0,
    providerAttempts: unique.length && unique.every(r => r.providerAttempts !== null && text(r.providerAttemptsEvidenceRef)) ? unique.reduce((n, r) => n + r.providerAttempts!, 0) : null,
    observedUsage: unique.map(r => ({actualRequestId: r.actualRequestId, usage: r.usage, wallMs: r.wallMs, activeMs: r.activeMs})),
    jevCharges: unique.filter(r => r.kind === "jevHttp").map(r => ({actualRequestId: r.actualRequestId, usd: r.jevUsd, uncertainLiabilityMicroUsd: r.uncertainLiabilityMicroUsd})),
    nativeUsd: null, wholeSessionSavingsEstablished: false};
}
export const accountRequests = (receipts: readonly ActualRequestReceipt[], owner: OwnerOccurrenceDeclarations, repairs: readonly PresentationRepair[] = []) => evaluateRequests(receipts, owner, repairs);
export const checkNextRequest = (history: readonly ActualRequestReceipt[], next: PlannedRequest, owner: OwnerOccurrenceDeclarations, repairs: readonly PresentationRepair[] = []) => evaluateRequests(history, owner, repairs, next);
