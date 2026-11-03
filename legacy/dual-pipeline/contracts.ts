import type {
  DecisionRecord,
  GitWorkRecord,
  LogicalIdentity,
  PlanRecord,
  SpecRecord,
  TaskOperationalState,
  TaskRecord,
} from "/LOCAL_HOME/projects/agent-platform/packages/work-continuity/src/git-work/types.ts";
import type {
  QualityFacet,
  RestorationCase,
  SourceLocation,
} from "../contract.ts";

export type {
  DecisionRecord,
  GitWorkRecord,
  LogicalIdentity,
  PlanRecord,
  QualityFacet,
  RestorationCase,
  SourceLocation,
  SpecRecord,
  TaskOperationalState,
  TaskRecord,
};

export const HARNESS_IDENTITIES = {
  domainId: "mathematics-document-editing",
  projectId: "math-problem-restoration",
  existingPilotWorkId: "jungdong-grade8-midterm-2026",
  pipelineWorkId: "dual-route-authoring-pipeline-20261020",
  issueId: "dual-route-cost-quality-selection",
  ontologyVersion: "0.2.0",
  governingDecisionIds: ["D-DUAL-ROUTES", "D-API-BUDGET-HARNESS"] as const,
  tasks: {
    contract: {
      taskId: "T-DUAL-CONTRACT",
      specId: "S-T-DUAL-CONTRACT",
      specRevision: 1,
      planId: "P-T-DUAL-CONTRACT",
      planRevision: 1,
      executionClass: "source-only",
    },
    implement: {
      taskId: "T-DUAL-IMPLEMENT",
      specId: "S-T-DUAL-IMPLEMENT",
      specRevision: 1,
      planId: "P-T-DUAL-IMPLEMENT",
      planRevision: 1,
      executionClass: "source-only",
    },
    evaluate: {
      taskId: "T-DUAL-EVALUATE",
      specId: "S-T-DUAL-EVALUATE",
      specRevision: 1,
      planId: "P-T-DUAL-EVALUATE",
      planRevision: 1,
      executionClass: "native-effect",
    },
    review: {
      taskId: "T-DUAL-REVIEW",
      specId: "S-T-DUAL-REVIEW",
      specRevision: 1,
      planId: "P-T-DUAL-REVIEW",
      planRevision: 1,
      executionClass: "source-only",
    },
  },
} as const;

export const JEV_NATIVE_IMAGE_LIMITS = {
  allowedFormats: ["PNG", "JPEG"] as const,
  minWidthPx: 280,
  minHeightPx: 280,
  maxWidthPx: 1568,
  maxHeightPx: 1568,
  minPixels: 78_400,
  maxPixels: 2_458_624,
  maxDecodedFileBytes: 16 * 1024 * 1024,
  maxRequestBodyBytes: 32 * 1024 * 1024,
} as const;

export const SESSION_BUDGET_CONSTANTS = {
  authorityInputId: "input-034",
  currency: "USD",
  sessionTotalCapUsd: 10,
  sessionTotalCapMicroUsd: 10_000_000,
  priorSpentMicroUsd: 11_496,
  priorSpentUsd: 0.011496,
  initialRemainingNewCallMicroUsd: 9_988_504,
  paidCallOwner: "math-argon-lead",
  forbiddenWorkerCallers: [
    "argon-dual-builder",
    "argon-export-docx",
    "argon-export-hwpx",
    "math-gpt-raw",
    "math-argon-raw",
  ] as const,
  defaultLedgerPath: "argon-pipeline/budget-ledger.jsonl",
  priorCostsPath: "argon-pipeline/prior-api-costs.json",
  budgetPolicyPath: "argon-pipeline/budget-policy.json",
} as const;

/**
 * Public catalog pricing observed in evidence/vercel/public-model-catalog.json
 * (SHA256 de770d03cbccdf9f6174759a8e449d41376100169fea976312ce133a734dd981).
 * Rates are expressed in nanoUSD per token (1 microUSD = 1,000 nanoUSD) so integer
 * arithmetic can compute exact ceiling microUSD reservations before a call.
 */
export interface CatalogModelPricing {
  modelId: RouteModelId;
  role: "vision-decision" | "generative-vision";
  contextWindowTokens: number;
  maxOutputTokens: number;
  inputNanoUsdPerToken: number;
  inputCacheWriteNanoUsdPerToken: number;
  inputCacheReadNanoUsdPerToken: number;
  outputNanoUsdPerToken: number;
  sourceCatalogPath: string;
  sourceCatalogSha256: string;
}

export type JevRouteModelId = "typesafe-ai/jev-1.14.0";
export type BaselineRouteModelId = "openai/gpt-6.1-sol" | "google/gemini-2.5-pro";
export type RouteModelId = JevRouteModelId | BaselineRouteModelId;

export type RouteId = "systemone-jev-1.14" | "gpt-gemini-baseline";

export type JevEndpointTransportKind =
  | "gateway-openai-decisions"
  | "gateway-typesafe-systemone-compat";

export const VERIFIED_MODEL_PRICING: Record<RouteModelId, CatalogModelPricing> = {
  "typesafe-ai/jev-1.14.0": {
    modelId: "typesafe-ai/jev-1.14.0",
    role: "vision-decision",
    contextWindowTokens: 32_000,
    maxOutputTokens: 0,
    inputNanoUsdPerToken: 42, // $0.000000042 / token ($0.042 / 1M tokens)
    inputCacheWriteNanoUsdPerToken: 42,
    inputCacheReadNanoUsdPerToken: 42,
    outputNanoUsdPerToken: 0, // output tokens free of charge
    sourceCatalogPath: "evidence/vercel/public-model-catalog.json",
    sourceCatalogSha256: "de770d03cbccdf9f6174759a8e449d41376100169fea976312ce133a734dd981",
  },
  "openai/gpt-6.1-sol": {
    modelId: "openai/gpt-6.1-sol",
    role: "generative-vision",
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    inputNanoUsdPerToken: 2_000, // $0.000002 / token ($2.00 / 1M tokens, tier <= 272k)
    inputCacheWriteNanoUsdPerToken: 2_500, // $0.0000025 / token ($2.50 / 1M tokens)
    inputCacheReadNanoUsdPerToken: 100, // $0.0000001 / token
    outputNanoUsdPerToken: 10_000, // $0.00001 / token ($10.00 / 1M tokens, tier <= 272k)
    sourceCatalogPath: "evidence/vercel/public-model-catalog.json",
    sourceCatalogSha256: "de770d03cbccdf9f6174759a8e449d41376100169fea976312ce133a734dd981",
  },
  "google/gemini-2.5-pro": {
    modelId: "google/gemini-2.5-pro",
    role: "generative-vision",
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_535,
    inputNanoUsdPerToken: 1_250, // $0.00000125 / token ($1.25 / 1M tokens, tier <= 200k)
    inputCacheWriteNanoUsdPerToken: 1_250,
    inputCacheReadNanoUsdPerToken: 125, // $0.000000125 / token
    outputNanoUsdPerToken: 10_000, // $0.00001 / token ($10.00 / 1M tokens, tier <= 200k)
    sourceCatalogPath: "evidence/vercel/public-model-catalog.json",
    sourceCatalogSha256: "de770d03cbccdf9f6174759a8e449d41376100169fea976312ce133a734dd981",
  },
};

/**
 * Pipeline stage roles.
 * - `source-pinning`: Binds immutable PDF/crop/bundle SHA256 hashes and source uncertainty.
 * - `optional-generative-authoring`: Baseline-only freeform OCR/LaTeX/SVG draft stage.
 *   Explicitly NOT comparable with Jev-1.14 (which is a structured Decision model).
 * - `comparable-decision`: Shared bounded candidate-selection and defect-classification stage
 *   executed identically by both routes (`systemone-jev-1.14` and `gpt-gemini-baseline`).
 * - `hitl-gate-escalation`: Combines decision results with pinned source uncertainty;
 *   never auto-approves unknown source or reduces HITL gates.
 */
export type PipelineStageRole =
  | "source-pinning"
  | "optional-generative-authoring"
  | "comparable-decision"
  | "hitl-gate-escalation";

export type CandidateChoiceLabel = "A" | "B" | "C" | "D" | "none" | "unclear";

export type DefectChoiceLabel =
  | "missing_label"
  | "wrong_line_style"
  | "wrong_shape"
  | "student_mark_contamination"
  | "none"
  | "unclear";

export interface PinnedImageAsset {
  assetId: string;
  role: "reference-montage" | "source-region" | "candidate-panel" | "detail-crop-evidence-only";
  path: string;
  sha256: string;
  mimeType: "image/png" | "image/jpeg";
  widthPx: number;
  heightPx: number;
  byteLength: number;
  jevImageBoundsPassed: boolean;
  sendToVisionModel: boolean;
}

export interface ScopedReferenceProvenance {
  scopeKind:
    | "preflighted-synthetic-canary"
    | "excluded-invalid-synthetic-fixture"
    | "user-accepted-pilot-gate-1"
    | "user-accepted-pilot-gate-2"
    | "held-pilot-gate-3"
    | "unadjudicated-raw-observation";
  authorityInputId: string | null;
  referencePaths: { path: string; sha256: string }[];
  establishedScopeDescription: string;
  unestablishedScopeDescription: string;
  accuracyEligible: boolean;
  exclusionReason?: string;
}

export interface SourceUncertaintyPin {
  id: string;
  problemContentId: string;
  status: "confirmed-clean" | "ambiguous" | "unrecoverable-from-selected-source" | "not-yet-transcribed";
  description: string;
  markOverlap: RestorationCase["markOverlap"];
  detailImagePins: { path: string; sha256: string }[];
  modelAgreementCanResolve: false;
  mathSolvingCanResolve: false;
}

export interface CandidateDescriptor {
  label: Exclude<CandidateChoiceLabel, "none" | "unclear">;
  description: string;
  sourceArtifactPath?: string;
  sourceArtifactSha256?: string;
}

export interface DecisionTaskUnit {
  schema: "math-editing.dual-route-decision-task.v1";
  unitId: string;
  problemContentId: string;
  problemNumber: number | null;
  stageRole: "comparable-decision";
  sourcePdfSha256: string | null;
  images: PinnedImageAsset[];
  candidates: CandidateDescriptor[];
  designatedPanelForDefect: Exclude<CandidateChoiceLabel, "none" | "unclear"> | null;
  taskInstructions: {
    bestCandidatePrompt: string;
    defectPrompt: string;
    candidateChoices: Record<CandidateChoiceLabel, string>;
    defectChoices: Partial<Record<DefectChoiceLabel, string>> &
      Pick<Record<DefectChoiceLabel, string>, "missing_label" | "wrong_line_style" | "wrong_shape" | "none" | "unclear">;
  };
  referenceProvenance: ScopedReferenceProvenance;
  sourceUncertainties: SourceUncertaintyPin[];
  hiddenGroundTruth?: {
    best_candidate: CandidateChoiceLabel;
    defect: DefectChoiceLabel;
    blindedFromModelRequest: true;
  } | null;
}

export interface OptionalGenerativeStageSpec {
  schema: "math-editing.optional-generative-stage.v1";
  stageRole: "optional-generative-authoring";
  supportedRoutes: ["gpt-gemini-baseline"];
  jevSupported: false;
  nonEquivalenceReason: "System One Jev-1.14 is a structured Decision model returning discrete choice/score/noul distributions; freeform OCR transcription and SVG/TikZ code generation are distinct baseline-only authoring stages and must not be scored as a common benchmark.";
  outputKind: "normalized-latex-and-visual-scene-draft";
}

export interface RouteExecutionConfig {
  routeId: RouteId;
  modelId: RouteModelId;
  jevTransportKind?: JevEndpointTransportKind;
  gptReasoningEffort?: "low" | "medium" | "high";
  maxInputTokensEstimate: number;
  maxOutputTokens: number;
  maxRequestsPerInvocation: 1;
  maxRetries: number;
  timeoutMs: number;
}

export interface RouteSpecificDiagnostics {
  kind: "jev-native-distribution" | "generative-schema-constrained";
  probabilitiesCalibratedEquivalently: false;
  jevChoiceConfidences?: {
    best_candidate: number;
    defect: number;
  };
  jevChoiceProbabilities?: {
    best_candidate: Record<string, number>;
    defect: Record<string, number>;
  };
  generativeReasoningTokens?: number;
  rawOutputText?: string;
}

export type FinalGateDisposition =
  | "candidate-admitted-for-human-gate-review"
  | "reject-candidate-defect-detected"
  | "escalate-hitl-unknown-source"
  | "escalate-hitl-model-unclear-or-none"
  | "excluded-invalid-fixture"
  | "blocked-problem-03-hold";

export interface CanonicalDecisionResult {
  schema: "math-editing.dual-route-decision-result.v1";
  unitId: string;
  problemContentId: string;
  routeId: RouteId;
  requestedModelId: RouteModelId;
  returnedModelId: string;
  endpoint: string;
  transportMode: "fake-offline" | "saved-probe-replay" | "live-gateway";
  inputImageSha256List: string[];
  requestBodySha256: string;
  httpStatus: number;
  provider: string;
  generationId: string | null;
  modelAttemptCount: number;
  providerAttemptCount: number;
  fallbackUsed: boolean;
  answers: {
    best_candidate: CandidateChoiceLabel;
    defect: DefectChoiceLabel;
  };
  diagnostics: RouteSpecificDiagnostics;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens: number;
    cacheWriteInputTokens: number;
    reasoningOutputTokens: number;
  };
  cost: {
    reservedMicroUsd: number;
    actualMicroUsd: number | null;
    settledMicroUsd: number;
    costSource: "gateway-reported" | "estimated-from-catalog" | "uncertain-locked-reserve" | "offline-zero";
  };
  elapsedMs: number;
  sourceUncertaintyState: {
    hasUnresolvedSourceUncertainty: boolean;
    uncertaintyIds: string[];
    unknownSourcePreserved: true;
  };
  accuracyEvaluation: {
    accuracyEligible: boolean;
    bestCandidateCorrect: boolean | null;
    defectCorrect: boolean | null;
    exclusionReason: string | null;
  };
  finalDisposition: FinalGateDisposition;
  hitlGateReduced: false;
  originalSourceEstablishedByModel: false;
  acceptanceDecision: null;
}

export type BudgetLedgerEventKind =
  | "prior-spend-baseline"
  | "reservation-created"
  | "reservation-settled-actual"
  | "reservation-locked-uncertain"
  | "reservation-released-precall-abort";

export interface BudgetLedgerEntry {
  schema: "math-editing.budget-ledger-entry.v1";
  timestamp: string;
  eventKind: BudgetLedgerEventKind;
  reservationId: string;
  requestKey: string;
  callerOwner: string;
  routeId: RouteId | "prior-synthetic-probes";
  modelId: RouteModelId | "prior-combined";
  unitId: string;
  reservedMicroUsd: number;
  actualMicroUsd: number | null;
  effectiveCommittedMicroUsd: number;
  cumulativeCommittedMicroUsd: number;
  remainingBudgetMicroUsd: number;
  sessionCapMicroUsd: 10_000_000;
  status: "active-reserved" | "settled" | "uncertain-locked" | "aborted-before-send";
  generationId: string | null;
  receiptPath: string | null;
  receiptSha256: string | null;
  notes: string;
}

export interface BudgetSnapshot {
  schema: "math-editing.budget-snapshot.v1";
  sessionCapMicroUsd: 10_000_000;
  priorSpentMicroUsd: number;
  activeReservedMicroUsd: number;
  settledNewMicroUsd: number;
  uncertainLockedMicroUsd: number;
  totalCommittedMicroUsd: number;
  remainingMicroUsd: number;
  uncertainRequestKeys: string[];
  settledRequestKeys: string[];
}

export interface RouteComparisonReport {
  schema: "math-editing.dual-route-comparison-report.v1";
  generatedAt: string;
  logical: LogicalIdentity;
  transportMode: "fake-offline" | "saved-probe-replay" | "live-gateway";
  unitsCompared: string[];
  excludedUnits: { unitId: string; reason: string }[];
  heldProblems: { problemNumber: 3; authorityInputId: "input-030"; enforced: true };
  resultsByUnit: {
    unitId: string;
    problemContentId: string;
    sameInputImageHashesVerified: boolean;
    sameChoiceSetsVerified: boolean;
    jevResult: CanonicalDecisionResult;
    baselineResult: CanonicalDecisionResult;
    modelsAgreedOnCandidate: boolean;
    modelsAgreedOnDefect: boolean;
    unknownSourcePreservedDespiteAgreement: boolean;
    finalUnitDisposition: FinalGateDisposition;
  }[];
  summary: {
    eligibleUnitsCount: number;
    excludedUnitsCount: number;
    jevEligibleCandidateCorrectCount: number;
    baselineEligibleCandidateCorrectCount: number;
    jevEligibleDefectCorrectCount: number;
    baselineEligibleDefectCorrectCount: number;
    jevTotalCommittedMicroUsd: number;
    baselineTotalCommittedMicroUsd: number;
    jevMeanElapsedMs: number;
    baselineMeanElapsedMs: number;
  };
  budgetAfterRun: BudgetSnapshot;
  winnerSelected: null;
  hitlGateReductionEstablished: false;
  acceptanceDecision: null;
  limitations: string[];
}

// Additive production binding types; historical variants remain unchanged.
export type { TrialDispatch as ProgressiveTrialDispatch, TrialAuthority as ProgressiveTrialAuthority, Primitives as ProgressiveRuntimePrimitives } from "./src/progressive/bindings.ts";
