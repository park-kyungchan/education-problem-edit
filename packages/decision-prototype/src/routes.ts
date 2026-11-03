import { createHash } from "node:crypto";
import {
  type CandidateChoiceLabel,
  type CanonicalDecisionResult,
  type DecisionTaskUnit,
  type DefectChoiceLabel,
  type JevEndpointTransportKind,
  type PinnedImageAsset,
  type RouteExecutionConfig,
  type RouteId,
  type RouteModelId,
} from "../contracts.ts";
import {
  computeCatalogEstimatedMicroUsd,
  parseUsdStringToMicroUsd,
} from "./budget.ts";
import {
  evaluateHitlGateDisposition,
  hasUnresolvedSourceUncertainty,
} from "./stages.ts";

export interface PreparedRouteRequest {
  routeId: RouteId;
  modelId: RouteModelId;
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  bodyJson: string;
  bodySha256: string;
  inputImageSha256List: string[];
  requestKey: string;
}

export function defaultRouteConfig(
  routeId: RouteId,
  options?: {
    baselineModelId?: "openai/gpt-6.1-sol" | "google/gemini-2.5-pro";
    jevTransportKind?: JevEndpointTransportKind;
    maxRetries?: number;
  },
): RouteExecutionConfig {
  if (routeId === "systemone-jev-1.14") {
    return {
      routeId: "systemone-jev-1.14",
      modelId: "typesafe-ai/jev-1.14.0",
      jevTransportKind: options?.jevTransportKind ?? "gateway-openai-decisions",
      maxInputTokensEstimate: 6_000,
      maxOutputTokens: 0,
      maxRequestsPerInvocation: 1,
      maxRetries: options?.maxRetries ?? 0,
      timeoutMs: 55_000,
    };
  }
  const modelId = options?.baselineModelId ?? "openai/gpt-6.1-sol";
  return {
    routeId: "gpt-gemini-baseline",
    modelId,
    gptReasoningEffort: modelId === "openai/gpt-6.1-sol" ? "low" : undefined,
    maxInputTokensEstimate: 6_000,
    maxOutputTokens: 1_024,
    maxRequestsPerInvocation: 1,
    maxRetries: options?.maxRetries ?? 0,
    timeoutMs: 55_000,
  };
}

function deterministicAssetReferenceUuid(unitId: string, assetId: string, sha256: string): string {
  const hex = createHash("sha256")
    .update(`jev-asset-ref:${unitId}:${assetId}:${sha256}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function buildPreparedRouteRequest(params: {
  unit: DecisionTaskUnit;
  config: RouteExecutionConfig;
  loadedImages: Map<string, { asset: PinnedImageAsset; bytes: Buffer; base64: string }>;
}): PreparedRouteRequest {
  const { unit, config, loadedImages } = params;
  const visionAssets = unit.images.filter((img) => img.sendToVisionModel);
  if (visionAssets.length === 0) {
    throw new Error(`NO_VISION_ASSETS_FOR_REQUEST:${unit.unitId}`);
  }
  const inputImageSha256List = visionAssets.map((a) => a.sha256);

  const candidateChoiceEntries = Object.entries(unit.taskInstructions.candidateChoices) as [
    CandidateChoiceLabel,
    string,
  ][];
  const defectChoiceEntries = Object.entries(unit.taskInstructions.defectChoices).filter(
    (entry): entry is [DefectChoiceLabel, string] => typeof entry[1] === "string",
  );

  if (config.routeId === "systemone-jev-1.14") {
    if (config.modelId !== "typesafe-ai/jev-1.14.0") {
      throw new Error(`INVALID_JEV_MODEL_ID:${config.modelId}`);
    }
    const transportKind = config.jevTransportKind ?? "gateway-openai-decisions";
    if (transportKind === "gateway-typesafe-systemone-compat") {
      const endpoint = "https://ai-gateway.vercel.sh/typesafe/v1/systemone";
      const visuals: Record<string, string> = {};
      const assets: Record<
        string,
        { type: "image"; format: "png" | "jpeg"; data_base64: string }
      > = {};

      for (const item of visionAssets) {
        const loaded = loadedImages.get(item.assetId);
        if (!loaded) throw new Error(`MISSING_LOADED_IMAGE:${item.assetId}`);
        const cleanBase64 = loaded.base64.replace(/\s+/g, "");
        if (cleanBase64.startsWith("data:")) {
          throw new Error("NATIVE_JEV_BASE64_MUST_NOT_HAVE_DATA_PREFIX");
        }
        const refUuid = deterministicAssetReferenceUuid(unit.unitId, item.assetId, item.sha256);
        visuals[`slot_${item.assetId}`] = refUuid;
        assets[refUuid] = {
          type: "image",
          format: item.mimeType === "image/png" ? "png" : "jpeg",
          data_base64: cleanBase64,
        };
      }

      const body: Record<string, unknown> = {
        model: "typesafe-ai/jev-1.14.0",
        state: {
          fixture_id: unit.unitId,
          visuals,
        },
        assets,
        questions: {
          best_candidate: {
            type: "choice",
            instructions: unit.taskInstructions.bestCandidatePrompt,
            criteria: Object.fromEntries(candidateChoiceEntries),
          },
          defect: {
            type: "choice",
            instructions: unit.taskInstructions.defectPrompt,
            criteria: Object.fromEntries(defectChoiceEntries),
          },
        },
      };
      const bodyJson = JSON.stringify(body);
      const bodySha256 = createHash("sha256").update(bodyJson).digest("hex");
      return {
        routeId: config.routeId,
        modelId: config.modelId,
        endpoint,
        headers: {
          "Content-Type": "application/json",
          "TypeSafe-Danger-Zone-Images": "true",
        },
        body,
        bodyJson,
        bodySha256,
        inputImageSha256List,
        requestKey: `${unit.unitId}:${config.routeId}:${config.modelId}:${transportKind}:${bodySha256}`,
      };
    }

    // Default verified Jev Gateway endpoint: POST https://ai-gateway.vercel.sh/v1/decisions
    const endpoint = "https://ai-gateway.vercel.sh/v1/decisions";
    const imageContentBlocks = visionAssets.map((item) => {
      const loaded = loadedImages.get(item.assetId);
      if (!loaded) throw new Error(`MISSING_LOADED_IMAGE:${item.assetId}`);
      return {
        type: "input_image" as const,
        image_url: `data:${item.mimeType};base64,${loaded.base64}`,
        detail: "high" as const,
      };
    });

    const body: Record<string, unknown> = {
      model: "typesafe-ai/jev-1.14.0",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Use the visual fixture to answer the named questions. Do not use filenames or metadata to infer answers.",
            },
            ...imageContentBlocks,
          ],
        },
      ],
      questions: [
        {
          type: "choice",
          name: "best_candidate",
          instructions: unit.taskInstructions.bestCandidatePrompt,
          choices: candidateChoiceEntries.map(([value, description]) => ({
            value,
            description,
          })),
        },
        {
          type: "choice",
          name: "defect",
          instructions: unit.taskInstructions.defectPrompt,
          choices: defectChoiceEntries.map(([value, description]) => ({
            value,
            description,
          })),
        },
      ],
    };
    const bodyJson = JSON.stringify(body);
    const bodySha256 = createHash("sha256").update(bodyJson).digest("hex");
    return {
      routeId: config.routeId,
      modelId: config.modelId,
      endpoint,
      headers: {
        "Content-Type": "application/json",
      },
      body,
      bodyJson,
      bodySha256,
      inputImageSha256List,
      requestKey: `${unit.unitId}:${config.routeId}:${config.modelId}:${transportKind}:${bodySha256}`,
    };
  }

  // Baseline route: GPT-6.1 Sol or Gemini 2.5 Pro via /v1/responses
  if (
    config.modelId !== "openai/gpt-6.1-sol" &&
    config.modelId !== "google/gemini-2.5-pro"
  ) {
    throw new Error(`INVALID_BASELINE_MODEL_ID:${config.modelId}`);
  }
  const endpoint = "https://ai-gateway.vercel.sh/v1/responses";
  const imageContentBlocks = visionAssets.map((item) => {
    const loaded = loadedImages.get(item.assetId);
    if (!loaded) throw new Error(`MISSING_LOADED_IMAGE:${item.assetId}`);
    return {
      type: "input_image" as const,
      image_url: `data:${item.mimeType};base64,${loaded.base64}`,
      detail: "high" as const,
    };
  });

  const body: Record<string, unknown> = {
    model: config.modelId,
    input: [
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `${unit.taskInstructions.bestCandidatePrompt}\n${unit.taskInstructions.defectPrompt}`,
          },
          ...imageContentBlocks,
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "common_visual_decision",
        strict: true,
        schema: {
          type: "object",
          properties: {
            best_candidate: {
              type: "string",
              enum: candidateChoiceEntries.map(([value]) => value),
            },
            defect: {
              type: "string",
              enum: defectChoiceEntries.map(([value]) => value),
            },
          },
          required: ["best_candidate", "defect"],
          additionalProperties: false,
        },
      },
    },
    max_output_tokens: config.maxOutputTokens,
  };
  if (config.modelId === "openai/gpt-6.1-sol") {
    body.reasoning = { effort: config.gptReasoningEffort ?? "low" };
  }

  const bodyJson = JSON.stringify(body);
  const bodySha256 = createHash("sha256").update(bodyJson).digest("hex");
  return {
    routeId: config.routeId,
    modelId: config.modelId,
    endpoint,
    headers: {
      "Content-Type": "application/json",
    },
    body,
    bodyJson,
    bodySha256,
    inputImageSha256List,
    requestKey: `${unit.unitId}:${config.routeId}:${config.modelId}:gateway-responses:${bodySha256}`,
  };
}

export interface RawTransportResponseEnvelope {
  httpStatus: number;
  elapsedMs: number;
  body: Record<string, unknown>;
  transportMode: "fake-offline" | "saved-probe-replay" | "live-gateway";
  reservedMicroUsd: number;
}

export function normalizeRouteResponse(params: {
  unit: DecisionTaskUnit;
  prepared: PreparedRouteRequest;
  raw: RawTransportResponseEnvelope;
}): CanonicalDecisionResult {
  const { unit, prepared, raw } = params;
  if (raw.httpStatus !== 200) {
    throw new Error(`NON_200_HTTP_STATUS:${raw.httpStatus}`);
  }

  const body = raw.body;
  const returnedModelId = typeof body.model === "string" ? body.model : "";
  if (returnedModelId !== prepared.modelId) {
    throw new Error(
      `MODEL_IDENTITY_MISMATCH:requested=${prepared.modelId},returned=${returnedModelId}`,
    );
  }

  const providerMeta = (body.provider_metadata ?? body.providerMetadata ?? {}) as Record<
    string,
    unknown
  >;
  const gatewayMeta = (providerMeta.gateway ?? {}) as Record<string, unknown>;
  const routingMeta = (gatewayMeta.routing ?? {}) as Record<string, unknown>;

  const modelAttemptCount =
    typeof routingMeta.modelAttemptCount === "number" ? routingMeta.modelAttemptCount : 1;
  const providerAttemptCount =
    typeof routingMeta.totalProviderAttemptCount === "number"
      ? routingMeta.totalProviderAttemptCount
      : 1;
  const finalProvider =
    typeof routingMeta.finalProvider === "string"
      ? routingMeta.finalProvider
      : typeof routingMeta.resolvedProvider === "string"
        ? routingMeta.resolvedProvider
        : prepared.routeId === "systemone-jev-1.14"
          ? "typesafe-ai"
          : prepared.modelId.split("/")[0]!;

  if (modelAttemptCount !== 1 || providerAttemptCount !== 1) {
    throw new Error(
      `FALLBACK_OR_RETRY_DETECTED_IN_ROUTING:modelAttempts=${modelAttemptCount},providerAttempts=${providerAttemptCount}`,
    );
  }

  const generationId =
    typeof gatewayMeta.generationId === "string"
      ? gatewayMeta.generationId
      : typeof body.id === "string"
        ? body.id
        : null;

  const allowedCandidates = new Set(Object.keys(unit.taskInstructions.candidateChoices));
  const allowedDefects = new Set(
    Object.entries(unit.taskInstructions.defectChoices)
      .filter(([, v]) => typeof v === "string")
      .map(([k]) => k),
  );

  let bestCandidate: CandidateChoiceLabel;
  let defect: DefectChoiceLabel;
  let diagnostics: CanonicalDecisionResult["diagnostics"];

  if (prepared.routeId === "systemone-jev-1.14") {
    // Support both /v1/decisions array answers and /typesafe/v1/systemone keyed answers
    let bestAns: Record<string, unknown> | undefined;
    let defectAns: Record<string, unknown> | undefined;

    if (Array.isArray(body.answers)) {
      bestAns = (body.answers as Record<string, unknown>[]).find(
        (a) => a.name === "best_candidate",
      );
      defectAns = (body.answers as Record<string, unknown>[]).find((a) => a.name === "defect");
    } else if (body.answers && typeof body.answers === "object") {
      const keyed = body.answers as Record<string, Record<string, unknown>>;
      bestAns = keyed.best_candidate;
      defectAns = keyed.defect;
    }

    if (!bestAns || !defectAns) {
      throw new Error("JEV_MISSING_NAMED_ANSWERS");
    }
    const rawCandidate = String(bestAns.choice ?? "");
    const rawDefect = String(defectAns.choice ?? "");
    if (!allowedCandidates.has(rawCandidate)) {
      throw new Error(`JEV_INVALID_CANDIDATE_CHOICE:${rawCandidate}`);
    }
    if (!allowedDefects.has(rawDefect)) {
      throw new Error(`JEV_INVALID_DEFECT_CHOICE:${rawDefect}`);
    }
    bestCandidate = rawCandidate as CandidateChoiceLabel;
    defect = rawDefect as DefectChoiceLabel;

    const toProbRecord = (val: unknown): Record<string, number> => {
      if (Array.isArray(val)) {
        return Object.fromEntries(
          val.map((item: { value?: string; probability?: number }) => [
            String(item.value ?? ""),
            Number(item.probability ?? 0),
          ]),
        );
      }
      if (val && typeof val === "object") {
        return Object.fromEntries(
          Object.entries(val as Record<string, unknown>).map(([k, v]) => [k, Number(v)]),
        );
      }
      return {};
    };

    diagnostics = {
      kind: "jev-native-distribution",
      probabilitiesCalibratedEquivalently: false,
      jevChoiceConfidences: {
        best_candidate: Number(bestAns.confidence ?? 0),
        defect: Number(defectAns.confidence ?? 0),
      },
      jevChoiceProbabilities: {
        best_candidate: toProbRecord(bestAns.probabilities),
        defect: toProbRecord(defectAns.probabilities),
      },
    };
  } else {
    // Baseline /v1/responses output parsing
    if (body.status && body.status !== "completed") {
      throw new Error(`BASELINE_RESPONSE_NOT_COMPLETED:${String(body.status)}`);
    }
    const outputArr = Array.isArray(body.output)
      ? (body.output as Record<string, unknown>[])
      : [];
    const messageItem = outputArr.find((o) => o.type === "message") ?? outputArr[0];
    const contentArr = Array.isArray(messageItem?.content)
      ? (messageItem.content as Record<string, unknown>[])
      : [];
    const textItem = contentArr.find((c) => c.type === "output_text") ?? contentArr[0];
    if (!textItem || typeof textItem.text !== "string") {
      throw new Error("BASELINE_MISSING_OUTPUT_TEXT");
    }
    let parsedJson: Record<string, unknown>;
    try {
      parsedJson = JSON.parse(textItem.text) as Record<string, unknown>;
    } catch {
      throw new Error("BASELINE_INVALID_JSON_OUTPUT");
    }
    const rawCandidate = String(parsedJson.best_candidate ?? "");
    const rawDefect = String(parsedJson.defect ?? "");
    if (!allowedCandidates.has(rawCandidate)) {
      throw new Error(`BASELINE_INVALID_CANDIDATE_CHOICE:${rawCandidate}`);
    }
    if (!allowedDefects.has(rawDefect)) {
      throw new Error(`BASELINE_INVALID_DEFECT_CHOICE:${rawDefect}`);
    }
    bestCandidate = rawCandidate as CandidateChoiceLabel;
    defect = rawDefect as DefectChoiceLabel;

    const usageRaw = (body.usage ?? {}) as Record<string, unknown>;
    const outputDetails = (usageRaw.output_tokens_details ?? {}) as Record<string, unknown>;
    diagnostics = {
      kind: "generative-schema-constrained",
      probabilitiesCalibratedEquivalently: false,
      generativeReasoningTokens: Number(outputDetails.reasoning_tokens ?? 0),
      rawOutputText: textItem.text,
    };
  }

  const usageObj = (body.usage ?? {}) as Record<string, unknown>;
  const inputDetails = (usageObj.input_tokens_details ?? {}) as Record<string, unknown>;
  const outputDetails = (usageObj.output_tokens_details ?? {}) as Record<string, unknown>;
  const inputTokens = Number(usageObj.input_tokens ?? usageObj.inputTokens ?? 0);
  const outputTokens = Number(usageObj.output_tokens ?? usageObj.outputTokens ?? 0);
  const totalTokens = Number(
    usageObj.total_tokens ?? usageObj.totalTokens ?? inputTokens + outputTokens,
  );
  const cachedInputTokens = Number(inputDetails.cached_tokens ?? 0);
  const cacheWriteInputTokens = Number(inputDetails.cache_write_tokens ?? 0);
  const reasoningOutputTokens = Number(outputDetails.reasoning_tokens ?? 0);

  let actualMicroUsd: number | null = null;
  let settledMicroUsd = 0;
  let costSource: CanonicalDecisionResult["cost"]["costSource"] = "offline-zero";

  if (typeof gatewayMeta.cost === "string" && gatewayMeta.cost.trim().length > 0) {
    actualMicroUsd = parseUsdStringToMicroUsd(gatewayMeta.cost);
    settledMicroUsd = actualMicroUsd;
    costSource = "gateway-reported";
  } else if (raw.transportMode === "live-gateway") {
    // Missing Gateway cost on a live call triggers uncertain-locked reserve
    actualMicroUsd = null;
    settledMicroUsd = raw.reservedMicroUsd;
    costSource = "uncertain-locked-reserve";
  } else if (inputTokens > 0 || outputTokens > 0) {
    actualMicroUsd = computeCatalogEstimatedMicroUsd(prepared.modelId, {
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cacheWriteInputTokens,
    });
    settledMicroUsd = raw.transportMode === "fake-offline" ? 0 : actualMicroUsd;
    costSource = raw.transportMode === "fake-offline" ? "offline-zero" : "estimated-from-catalog";
  }

  const { hasUnresolved, uncertaintyIds } = hasUnresolvedSourceUncertainty(unit);
  const answers = {
    best_candidate: bestCandidate,
    defect,
  };

  const accuracyEligible = unit.referenceProvenance.accuracyEligible;
  const truth = unit.hiddenGroundTruth ?? null;
  const accuracyEvaluation: CanonicalDecisionResult["accuracyEvaluation"] = {
    accuracyEligible,
    bestCandidateCorrect:
      accuracyEligible && truth ? answers.best_candidate === truth.best_candidate : null,
    defectCorrect: accuracyEligible && truth ? answers.defect === truth.defect : null,
    exclusionReason: accuracyEligible
      ? null
      : (unit.referenceProvenance.exclusionReason ??
        "Reference provenance not eligible for accuracy benchmark"),
  };

  const finalDisposition = evaluateHitlGateDisposition({ unit, answers });

  return {
    schema: "math-editing.dual-route-decision-result.v1",
    unitId: unit.unitId,
    problemContentId: unit.problemContentId,
    routeId: prepared.routeId,
    requestedModelId: prepared.modelId,
    returnedModelId,
    endpoint: prepared.endpoint,
    transportMode: raw.transportMode,
    inputImageSha256List: prepared.inputImageSha256List,
    requestBodySha256: prepared.bodySha256,
    httpStatus: raw.httpStatus,
    provider: finalProvider,
    generationId,
    modelAttemptCount,
    providerAttemptCount,
    fallbackUsed: false,
    answers,
    diagnostics,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens,
      cachedInputTokens,
      cacheWriteInputTokens,
      reasoningOutputTokens,
    },
    cost: {
      reservedMicroUsd: raw.reservedMicroUsd,
      actualMicroUsd,
      settledMicroUsd,
      costSource,
    },
    elapsedMs: raw.elapsedMs,
    sourceUncertaintyState: {
      hasUnresolvedSourceUncertainty: hasUnresolved,
      uncertaintyIds,
      unknownSourcePreserved: true,
    },
    accuracyEvaluation,
    finalDisposition,
    hitlGateReduced: false,
    originalSourceEstablishedByModel: false,
    acceptanceDecision: null,
  };
}
