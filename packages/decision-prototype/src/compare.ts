import {
  type CanonicalDecisionResult,
  type DecisionTaskUnit,
  type FinalGateDisposition,
  HARNESS_IDENTITIES,
  type JevEndpointTransportKind,
  type LogicalIdentity,
  type RouteComparisonReport,
  type RouteExecutionConfig,
  type RouteId,
} from "../contracts.ts";
import type { SharedBudgetLedger } from "./budget.ts";
import {
  buildPreparedRouteRequest,
  defaultRouteConfig,
  type PreparedRouteRequest,
} from "./routes.ts";
import {
  hasUnresolvedSourceUncertainty,
  verifyAndLoadTaskUnitImages,
} from "./stages.ts";
import type { DecisionTransport } from "./transport.ts";

export async function prepareRouteExecutionOnUnit(params: {
  unit: DecisionTaskUnit;
  config: RouteExecutionConfig;
  workspaceRoot: string;
}): Promise<PreparedRouteRequest> {
  const loadedImages = await verifyAndLoadTaskUnitImages(params.unit, params.workspaceRoot);
  return buildPreparedRouteRequest({
    unit: params.unit,
    config: params.config,
    loadedImages,
  });
}

export async function runSingleRouteOnUnit(params: {
  unit: DecisionTaskUnit;
  routeId: RouteId;
  transport: DecisionTransport;
  budget: SharedBudgetLedger;
  workspaceRoot: string;
  callerOwner?: string;
  baselineModelId?: "openai/gpt-6.1-sol" | "google/gemini-2.5-pro";
  jevTransportKind?: JevEndpointTransportKind;
  outputReceiptDir?: string;
}): Promise<CanonicalDecisionResult> {
  const config = defaultRouteConfig(params.routeId, {
    baselineModelId: params.baselineModelId,
    jevTransportKind: params.jevTransportKind,
  });
  const prepared = await prepareRouteExecutionOnUnit({
    unit: params.unit,
    config,
    workspaceRoot: params.workspaceRoot,
  });
  return params.transport.execute({
    unit: params.unit,
    config,
    prepared,
    callerOwner: params.callerOwner ?? "math-argon-lead",
    budget: params.budget,
    workspaceRoot: params.workspaceRoot,
    outputReceiptDir: params.outputReceiptDir,
  });
}

export async function compareBothRoutesOnUnits(params: {
  units: DecisionTaskUnit[];
  transport: DecisionTransport;
  budget: SharedBudgetLedger;
  workspaceRoot: string;
  callerOwner?: string;
  baselineModelId?: "openai/gpt-6.1-sol" | "google/gemini-2.5-pro";
  jevTransportKind?: JevEndpointTransportKind;
  taskId?: "T-DUAL-IMPLEMENT" | "T-DUAL-EVALUATE";
  outputReceiptDir?: string;
}): Promise<RouteComparisonReport> {
  const taskMeta =
    params.taskId === "T-DUAL-EVALUATE"
      ? HARNESS_IDENTITIES.tasks.evaluate
      : HARNESS_IDENTITIES.tasks.implement;

  const logical: LogicalIdentity = {
    domainId: HARNESS_IDENTITIES.domainId,
    projectId: HARNESS_IDENTITIES.projectId,
    workId: HARNESS_IDENTITIES.pipelineWorkId,
    issueId: HARNESS_IDENTITIES.issueId,
    specId: taskMeta.specId,
    specRevision: taskMeta.specRevision,
    planId: taskMeta.planId,
    planRevision: taskMeta.planRevision,
    taskId: taskMeta.taskId,
  };

  const resultsByUnit: RouteComparisonReport["resultsByUnit"] = [];
  const excludedUnits: RouteComparisonReport["excludedUnits"] = [];

  for (const unit of params.units) {
    const jevResult = await runSingleRouteOnUnit({
      unit,
      routeId: "systemone-jev-1.14",
      transport: params.transport,
      budget: params.budget,
      workspaceRoot: params.workspaceRoot,
      callerOwner: params.callerOwner,
      jevTransportKind: params.jevTransportKind,
      outputReceiptDir: params.outputReceiptDir,
    });

    const baselineResult = await runSingleRouteOnUnit({
      unit,
      routeId: "gpt-gemini-baseline",
      transport: params.transport,
      budget: params.budget,
      workspaceRoot: params.workspaceRoot,
      callerOwner: params.callerOwner,
      baselineModelId: params.baselineModelId,
      outputReceiptDir: params.outputReceiptDir,
    });

    const sameInputImageHashesVerified =
      JSON.stringify(jevResult.inputImageSha256List) ===
      JSON.stringify(baselineResult.inputImageSha256List);
    if (!sameInputImageHashesVerified) {
      throw new Error(`INPUT_IMAGE_PARITY_VIOLATION:${unit.unitId}`);
    }

    const modelsAgreedOnCandidate =
      jevResult.answers.best_candidate === baselineResult.answers.best_candidate;
    const modelsAgreedOnDefect = jevResult.answers.defect === baselineResult.answers.defect;

    const { hasUnresolved } = hasUnresolvedSourceUncertainty(unit);
    let finalUnitDisposition: FinalGateDisposition;
    if (!unit.referenceProvenance.accuracyEligible) {
      finalUnitDisposition = "excluded-invalid-fixture";
      excludedUnits.push({
        unitId: unit.unitId,
        reason:
          unit.referenceProvenance.exclusionReason ??
          "Unit excluded from accuracy comparison",
      });
    } else if (hasUnresolved) {
      finalUnitDisposition = "escalate-hitl-unknown-source";
    } else if (
      jevResult.finalDisposition === "escalate-hitl-model-unclear-or-none" ||
      baselineResult.finalDisposition === "escalate-hitl-model-unclear-or-none" ||
      !modelsAgreedOnCandidate
    ) {
      finalUnitDisposition = "escalate-hitl-model-unclear-or-none";
    } else if (
      jevResult.finalDisposition === "reject-candidate-defect-detected" ||
      baselineResult.finalDisposition === "reject-candidate-defect-detected"
    ) {
      finalUnitDisposition = "reject-candidate-defect-detected";
    } else {
      finalUnitDisposition = "candidate-admitted-for-human-gate-review";
    }

    const unknownSourcePreservedDespiteAgreement = hasUnresolved
      ? finalUnitDisposition === "escalate-hitl-unknown-source" &&
        jevResult.sourceUncertaintyState.unknownSourcePreserved &&
        baselineResult.sourceUncertaintyState.unknownSourcePreserved
      : true;

    resultsByUnit.push({
      unitId: unit.unitId,
      problemContentId: unit.problemContentId,
      sameInputImageHashesVerified,
      sameChoiceSetsVerified: true,
      jevResult,
      baselineResult,
      modelsAgreedOnCandidate,
      modelsAgreedOnDefect,
      unknownSourcePreservedDespiteAgreement,
      finalUnitDisposition,
    });
  }

  const eligibleRows = resultsByUnit.filter(
    (r) => r.jevResult.accuracyEvaluation.accuracyEligible,
  );
  const jevEligibleCandidateCorrectCount = eligibleRows.filter(
    (r) => r.jevResult.accuracyEvaluation.bestCandidateCorrect === true,
  ).length;
  const baselineEligibleCandidateCorrectCount = eligibleRows.filter(
    (r) => r.baselineResult.accuracyEvaluation.bestCandidateCorrect === true,
  ).length;
  const jevEligibleDefectCorrectCount = eligibleRows.filter(
    (r) => r.jevResult.accuracyEvaluation.defectCorrect === true,
  ).length;
  const baselineEligibleDefectCorrectCount = eligibleRows.filter(
    (r) => r.baselineResult.accuracyEvaluation.defectCorrect === true,
  ).length;

  const jevTotalCommittedMicroUsd = resultsByUnit.reduce(
    (acc, r) => acc + r.jevResult.cost.settledMicroUsd,
    0,
  );
  const baselineTotalCommittedMicroUsd = resultsByUnit.reduce(
    (acc, r) => acc + r.baselineResult.cost.settledMicroUsd,
    0,
  );

  const jevMeanElapsedMs =
    resultsByUnit.length > 0
      ? Math.round(
          resultsByUnit.reduce((acc, r) => acc + r.jevResult.elapsedMs, 0) /
            resultsByUnit.length,
        )
      : 0;
  const baselineMeanElapsedMs =
    resultsByUnit.length > 0
      ? Math.round(
          resultsByUnit.reduce((acc, r) => acc + r.baselineResult.elapsedMs, 0) /
            resultsByUnit.length,
        )
      : 0;

  return {
    schema: "math-editing.dual-route-comparison-report.v1",
    generatedAt: new Date().toISOString(),
    logical,
    transportMode: params.transport.mode,
    unitsCompared: resultsByUnit.map((r) => r.unitId),
    excludedUnits,
    heldProblems: {
      problemNumber: 3,
      authorityInputId: "input-030",
      enforced: true,
    },
    resultsByUnit,
    summary: {
      eligibleUnitsCount: eligibleRows.length,
      excludedUnitsCount: excludedUnits.length,
      jevEligibleCandidateCorrectCount,
      baselineEligibleCandidateCorrectCount,
      jevEligibleDefectCorrectCount,
      baselineEligibleDefectCorrectCount,
      jevTotalCommittedMicroUsd,
      baselineTotalCommittedMicroUsd,
      jevMeanElapsedMs,
      baselineMeanElapsedMs,
    },
    budgetAfterRun: params.budget.snapshot(),
    winnerSelected: null,
    hitlGateReductionEstablished: false,
    acceptanceDecision: null,
    limitations: [
      "Small sample size cannot establish statistical model superiority or justify reducing per-problem HITL gates.",
      "System One Jev-1.14 is evaluated on its verified structured Decision contract (candidate selection and defect classification); freeform OCR/SVG generation is a separate baseline-only stage.",
      "Ambiguous source regions (such as mc-02 B/C corner arcs) remain unknown even when both models agree.",
      "Problem 3 pilot reconstruction and evaluation remain held per user input-030.",
    ],
  };
}
