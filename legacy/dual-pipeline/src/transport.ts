import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertRecoveryLiveAdmission } from "./recovery.ts";
import { createReservationReceiptStore, writeReceiptExclusive } from "./receipt-store.ts";
import {
  type CandidateChoiceLabel,
  type CanonicalDecisionResult,
  type DecisionTaskUnit,
  type DefectChoiceLabel,
  type RouteExecutionConfig,
  SESSION_BUDGET_CONSTANTS,
} from "../contracts.ts";
import {
  parseUsdStringToMicroUsd,
  redactSecrets,
  type SharedBudgetLedger,
} from "./budget.ts";
import {
  normalizeRouteResponse,
  type PreparedRouteRequest,
  type RawTransportResponseEnvelope,
} from "./routes.ts";

export interface ExecuteTransportParams {
  unit: DecisionTaskUnit;
  config: RouteExecutionConfig;
  prepared: PreparedRouteRequest;
  callerOwner: string;
  budget: SharedBudgetLedger;
  workspaceRoot: string;
  outputReceiptDir?: string;
}

export interface DecisionTransport {
  readonly mode: "fake-offline" | "saved-probe-replay" | "live-gateway";
  execute(params: ExecuteTransportParams): Promise<CanonicalDecisionResult>;
}

export type FakeScenarioKind =
  | "normal-match"
  | "agree-on-ambiguous"
  | "timeout-uncertain"
  | "missing-cost-uncertain"
  | "fallback-routing-violation"
  | "model-mismatch-violation"
  | "secret-leak-attempt";

export interface FakeScenarioConfig {
  scenario?: FakeScenarioKind;
  bestCandidateOverride?: CandidateChoiceLabel;
  defectOverride?: DefectChoiceLabel;
  simulatedActualCostUsd?: string;
  simulatedInputTokens?: number;
  simulatedOutputTokens?: number;
  simulatedElapsedMs?: number;
  reserveInLedger?: boolean;
  syntheticSecretToInject?: string;
}

export class FakeDeterministicTransport implements DecisionTransport {
  public readonly mode = "fake-offline" as const;
  private readonly defaultConfig: FakeScenarioConfig;
  private readonly perRouteUnitOverrides = new Map<string, FakeScenarioConfig>();

  constructor(defaultConfig?: FakeScenarioConfig) {
    this.defaultConfig = defaultConfig ?? { scenario: "normal-match", reserveInLedger: true };
  }

  public setScenarioFor(
    unitId: string,
    routeId: RouteExecutionConfig["routeId"],
    cfg: FakeScenarioConfig,
  ): void {
    this.perRouteUnitOverrides.set(`${unitId}:${routeId}`, cfg);
  }

  public async execute(params: ExecuteTransportParams): Promise<CanonicalDecisionResult> {
    const { unit, config, prepared, callerOwner, budget } = params;
    const cfg =
      this.perRouteUnitOverrides.get(`${unit.unitId}:${config.routeId}`) ??
      this.defaultConfig;
    const scenario = cfg.scenario ?? "normal-match";
    const shouldReserve = cfg.reserveInLedger ?? true;

    if (cfg.syntheticSecretToInject) {
      budget.registerSecretForRedaction(cfg.syntheticSecretToInject);
    }

    let reservationId: string | null = null;
    let reservedMicroUsd = 0;

    if (shouldReserve) {
      const resEntry = await budget.reserveBeforeCall({
        requestKey: prepared.requestKey,
        callerOwner,
        unitId: unit.unitId,
        config,
        notes: cfg.syntheticSecretToInject
          ? `Simulated reservation with secret Bearer ${cfg.syntheticSecretToInject}`
          : "Fake transport pre-call reservation.",
      });
      reservationId = resEntry.reservationId;
      reservedMicroUsd = resEntry.reservedMicroUsd;
    }

    if (scenario === "timeout-uncertain") {
      if (reservationId) {
        await budget.lockUncertainCharge({
          reservationId,
          reason: "Simulated network timeout after request transmission; outcome unknown.",
        });
      }
      throw new Error("TRANSPORT_OUTCOME_UNKNOWN_DO_NOT_REPLAY:Simulated timeout");
    }

    if (scenario === "secret-leak-attempt") {
      const secret = cfg.syntheticSecretToInject ?? "vck_FAKE_SECRET_TOKEN_99999999";
      budget.registerSecretForRedaction(secret);
      const rawErr = `Upstream error with header Authorization: Bearer ${secret}`;
      const scrubbed = redactSecrets(rawErr, [secret]);
      if (reservationId) {
        await budget.lockUncertainCharge({
          reservationId,
          reason: scrubbed,
        });
      }
      throw new Error(`SANITIZED_TRANSPORT_FAILURE:${scrubbed}`);
    }

    const bestCandidate: CandidateChoiceLabel =
      cfg.bestCandidateOverride ??
      (scenario === "agree-on-ambiguous"
        ? "A"
        : (unit.hiddenGroundTruth?.best_candidate ?? "A"));
    const defect: DefectChoiceLabel =
      cfg.defectOverride ??
      (scenario === "agree-on-ambiguous"
        ? "none"
        : (unit.hiddenGroundTruth?.defect ?? "none"));

    const inputTokens = cfg.simulatedInputTokens ?? 3_500;
    const outputTokens =
      cfg.simulatedOutputTokens ?? (config.routeId === "systemone-jev-1.14" ? 117 : 28);
    const costUsd =
      cfg.simulatedActualCostUsd ??
      (config.routeId === "systemone-jev-1.14" ? "0.000147" : "0.003911");

    const returnedModel =
      scenario === "model-mismatch-violation" ? "unexpected/fallback-model" : config.modelId;
    const modelAttemptCount = scenario === "fallback-routing-violation" ? 2 : 1;

    const gatewayBlock: Record<string, unknown> = {
      routing: {
        originalModelId: config.modelId,
        resolvedProvider:
          config.routeId === "systemone-jev-1.14"
            ? "typesafe-ai"
            : config.modelId.split("/")[0],
        canonicalSlug: returnedModel,
        finalProvider:
          config.routeId === "systemone-jev-1.14"
            ? "typesafe-ai"
            : config.modelId.split("/")[0],
        modelAttemptCount,
        totalProviderAttemptCount: 1,
      },
      generationId: `gen_fake_${unit.unitId}_${config.routeId}`,
    };

    if (scenario !== "missing-cost-uncertain") {
      gatewayBlock.cost = costUsd;
    }

    let body: Record<string, unknown>;
    if (config.routeId === "systemone-jev-1.14") {
      body = {
        model: returnedModel,
        answers: [
          {
            type: "choice",
            name: "best_candidate",
            choice: bestCandidate,
            confidence: 0.95,
            probabilities: [
              { value: bestCandidate, probability: 0.95 },
              { value: "none", probability: 0.03 },
              { value: "unclear", probability: 0.02 },
            ],
          },
          {
            type: "choice",
            name: "defect",
            choice: defect,
            confidence: 0.92,
            probabilities: [
              { value: defect, probability: 0.92 },
              { value: "unclear", probability: 0.08 },
            ],
          },
        ],
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
        },
        provider_metadata: {
          typesafe: {
            confidence: { best_candidate: 0.95, defect: 0.92 },
          },
          gateway: gatewayBlock,
        },
      };
    } else {
      body = {
        id: `gen_fake_${unit.unitId}_${config.routeId}`,
        object: "response",
        status: "completed",
        model: returnedModel,
        output: [
          {
            type: "message",
            status: "completed",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ best_candidate: bestCandidate, defect }),
              },
            ],
          },
        ],
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
          input_tokens_details: {
            cached_tokens: 0,
            cache_write_tokens: Math.max(0, inputTokens - 3),
          },
          output_tokens_details: {
            reasoning_tokens: 0,
          },
        },
        provider_metadata: {
          gateway: gatewayBlock,
        },
      };
    }

    const raw: RawTransportResponseEnvelope = {
      httpStatus: 200,
      elapsedMs: cfg.simulatedElapsedMs ?? (config.routeId === "systemone-jev-1.14" ? 810 : 2950),
      body,
      transportMode: scenario === "missing-cost-uncertain" ? "live-gateway" : "fake-offline",
      reservedMicroUsd,
    };

    try {
      const normalized = normalizeRouteResponse({ unit, prepared, raw });
      if (reservationId) {
        if (normalized.cost.actualMicroUsd !== null) {
          await budget.settleActualCost({
            reservationId,
            actualMicroUsd: normalized.cost.actualMicroUsd,
            generationId: normalized.generationId,
            receiptPath: null,
            receiptSha256: null,
          });
        } else {
          await budget.lockUncertainCharge({
            reservationId,
            reason: "Missing Gateway cost field in response metadata.",
          });
        }
      }
      return normalized;
    } catch (error) {
      if (reservationId) {
        await budget.lockUncertainCharge({
          reservationId,
          reason: `Post-response validation failed: ${(error as Error).message}`,
        });
      }
      throw error;
    }
  }
}

const SAVED_PROBE_PATHS: Record<
  string,
  Record<"systemone-jev-1.14" | "gpt-gemini-baseline", { path: string; sha256: string }>
> = {
  "synthetic-contract-001-excluded": {
    "systemone-jev-1.14": {
      path: "model-probes/contract-001/jev-response.json",
      sha256: "060d1f53a619d3c1ff4938901a0ffa158d27aa0a3b0edb9bf9446c66ed8d6a62",
    },
    "gpt-gemini-baseline": {
      path: "model-probes/contract-001/gpt-response.json",
      sha256: "b8ea1c925748865ddb5a463c0ebe7ca2d0c7613fcb4db4299adaf512ca30e593",
    },
  },
  "synthetic-contract-002": {
    "systemone-jev-1.14": {
      path: "model-probes/contract-002/jev-response.json",
      sha256: "8094eec597fd6abac495066891e343e85181730a9fa42ab06a3b507933d35eca",
    },
    "gpt-gemini-baseline": {
      path: "model-probes/contract-002/gpt-response.json",
      sha256: "a8f5e2de542cc60f59470fd79362ef6b18d18ea1902db2d34cbefa9fc504b0fb",
    },
  },
};

export class SavedArtifactReplayTransport implements DecisionTransport {
  public readonly mode = "saved-probe-replay" as const;

  public async execute(params: ExecuteTransportParams): Promise<CanonicalDecisionResult> {
    const { unit, config, prepared, workspaceRoot } = params;
    const unitMapping = SAVED_PROBE_PATHS[unit.unitId];
    if (!unitMapping) {
      throw new Error(`NO_SAVED_PROBE_ARTIFACT_FOR_UNIT:${unit.unitId}`);
    }
    const pin = unitMapping[config.routeId];
    const absPath = resolve(workspaceRoot, pin.path);
    const rawBytes = await readFile(absPath);
    const actualSha = createHash("sha256").update(rawBytes).digest("hex");
    if (actualSha !== pin.sha256) {
      throw new Error(`SAVED_PROBE_RECEIPT_HASH_DRIFT:${pin.path}`);
    }
    const saved = JSON.parse(rawBytes.toString("utf8")) as {
      httpStatus: number;
      elapsedMs: number;
      imageSha256: string;
      body: Record<string, unknown>;
    };
    if (saved.imageSha256 !== prepared.inputImageSha256List[0]) {
      throw new Error(`SAVED_PROBE_IMAGE_SHA_MISMATCH:${pin.path}`);
    }
    const raw: RawTransportResponseEnvelope = {
      httpStatus: saved.httpStatus,
      elapsedMs: saved.elapsedMs,
      body: saved.body,
      transportMode: "saved-probe-replay",
      reservedMicroUsd: 0, // Historical spend already accounted in priorSpentMicroUsd (11,496)
    };
    return normalizeRouteResponse({ unit, prepared, raw });
  }
}

export class LiveGatewayTransport implements DecisionTransport {
  public readonly mode = "live-gateway" as const;
  private readonly gatewayEnvPath: string;

  constructor(options?: { gatewayEnvPath?: string }) {
    this.gatewayEnvPath =
      options?.gatewayEnvPath ?? "/LOCAL_HOME/.config/math-problem-editing/ai-gateway.env";
  }

  public async execute(params: ExecuteTransportParams): Promise<CanonicalDecisionResult> {
    const { unit, config, prepared, callerOwner, budget, workspaceRoot, outputReceiptDir } =
      params;

    if (callerOwner !== SESSION_BUDGET_CONSTANTS.paidCallOwner) {
      throw new Error(
        `LIVE_CALL_FORBIDDEN_FOR_WORKER:caller=${callerOwner};only ${SESSION_BUDGET_CONSTANTS.paidCallOwner} may execute paid API calls.`,
      );
    }
    // The old policy is historical evidence. It cannot grant live authority
    // after input-037. This fails before credential access or reservation.
    assertRecoveryLiveAdmission();
    if (process.env.ALLOW_PAID_API_CALLS !== "1") {
      throw new Error(
        "LIVE_CALL_REQUIRES_EXPLICIT_ENV:Set ALLOW_PAID_API_CALLS=1 when math-argon-lead executes T-DUAL-EVALUATE.",
      );
    }

    // Reserve ceiling cost in shared ledger BEFORE reading credentials or transmitting.
    const reservation = await budget.reserveBeforeCall({
      requestKey: prepared.requestKey,
      callerOwner,
      unitId: unit.unitId,
      config,
      notes: `Live Gateway call reservation for ${unit.unitId} (${config.routeId}/${config.modelId}).`,
    });

    let apiKey = "";
    try {
      const envText = await readFile(this.gatewayEnvPath, "utf8");
      const values = Object.fromEntries(
        envText
          .split(/\r?\n/)
          .filter((line) => line.includes("=") && !line.startsWith("#"))
          .map((line) => {
            const idx = line.indexOf("=");
            return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
          }),
      );
      apiKey = values.AI_GATEWAY_API_KEY ?? "";
      if (!apiKey) {
        await budget.abortBeforeSend({
          reservationId: reservation.reservationId,
          reason: "Missing AI_GATEWAY_API_KEY in gateway env file before send.",
        });
        throw new Error("MISSING_GATEWAY_CREDENTIAL_BEFORE_SEND");
      }
      budget.registerSecretForRedaction(apiKey);
    } catch (error) {
      if ((error as Error).message !== "MISSING_GATEWAY_CREDENTIAL_BEFORE_SEND") {
        await budget.abortBeforeSend({
          reservationId: reservation.reservationId,
          reason: `Credential file read failed before network send: ${(error as Error).name}`,
        });
      }
      throw error;
    }

    const receiptDir =
      outputReceiptDir ?? resolve(workspaceRoot, "dual-pipeline/evaluation/receipts", unit.unitId);
    const { manifestPath, responsePath, failurePath } = await createReservationReceiptStore(receiptDir, reservation.reservationId);

    const sanitizedManifest = {
      schema: "math-editing.dual-route-request-manifest.v1",
      createdAt: new Date().toISOString(),
      unitId: unit.unitId,
      routeId: config.routeId,
      requestedModelId: config.modelId,
      endpoint: prepared.endpoint,
      headers: {
        ...prepared.headers,
        Authorization: "Bearer [REDACTED]",
      },
      inputImageSha256List: prepared.inputImageSha256List,
      requestBodySha256: prepared.bodySha256,
      reservationId: reservation.reservationId,
      reservedMicroUsd: reservation.reservedMicroUsd,
      maxRetries: config.maxRetries,
    };
    await writeReceiptExclusive(manifestPath, JSON.stringify(sanitizedManifest, null, 2) + "\n");

    const startedAt = Date.now();
    try {
      const response = await fetch(prepared.endpoint, {
        method: "POST",
        headers: {
          ...prepared.headers,
          Authorization: `Bearer ${apiKey}`,
        },
        body: prepared.bodyJson,
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      const elapsedMs = Date.now() - startedAt;
      const rawText = redactSecrets(await response.text(), [apiKey]);
      let parsedBody: Record<string, unknown>;
      try {
        parsedBody = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        parsedBody = { nonJsonBody: rawText.slice(0, 4_000) };
      }

      const receiptEnvelope = {
        schema: "math-editing.dual-route-response-receipt.v1",
        observedAt: new Date().toISOString(),
        unitId: unit.unitId,
        routeId: config.routeId,
        requestedModelId: config.modelId,
        endpoint: prepared.endpoint,
        httpStatus: response.status,
        ok: response.ok,
        elapsedMs,
        inputImageSha256List: prepared.inputImageSha256List,
        requestBodySha256: prepared.bodySha256,
        responseHeaders: Object.fromEntries(
          [...response.headers].filter(([k]) =>
            ["x-request-id", "x-vercel-id", "x-ai-gateway-generation-id"].includes(
              k.toLowerCase(),
            ),
          ),
        ),
        body: parsedBody,
        acceptanceDecision: null,
      };
      const receiptJson = JSON.stringify(receiptEnvelope, null, 2) + "\n";
      await writeReceiptExclusive(responsePath, receiptJson);
      const receiptSha256 = createHash("sha256").update(receiptJson).digest("hex");

      const rawEnvelope: RawTransportResponseEnvelope = {
        httpStatus: response.status,
        elapsedMs,
        body: parsedBody,
        transportMode: "live-gateway",
        reservedMicroUsd: reservation.reservedMicroUsd,
      };

      const normalized = normalizeRouteResponse({ unit, prepared, raw: rawEnvelope });
      if (normalized.cost.actualMicroUsd !== null) {
        await budget.settleActualCost({
          reservationId: reservation.reservationId,
          actualMicroUsd: normalized.cost.actualMicroUsd,
          generationId: normalized.generationId,
          receiptPath: responsePath,
          receiptSha256,
        });
      } else {
        await budget.lockUncertainCharge({
          reservationId: reservation.reservationId,
          reason: "HTTP 200 received without provider_metadata.gateway.cost; reserve locked.",
          receiptPath: responsePath,
          receiptSha256,
        });
      }
      return normalized;
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const scrubbedMessage = redactSecrets((error as Error).message ?? "Unknown error", [
        apiKey,
      ]);
      const uncertainReceipt = {
        schema: "math-editing.dual-route-response-receipt.v1",
        observedAt: new Date().toISOString(),
        unitId: unit.unitId,
        routeId: config.routeId,
        requestedModelId: config.modelId,
        endpoint: prepared.endpoint,
        elapsedMs,
        status: "outcome-unknown-do-not-replay",
        errorClass: (error as Error).name,
        errorMessage: scrubbedMessage,
        acceptanceDecision: null,
      };
      const uncertainJson = JSON.stringify(uncertainReceipt, null, 2) + "\n";
      await writeReceiptExclusive(failurePath, uncertainJson);
      const receiptSha256 = createHash("sha256").update(uncertainJson).digest("hex");

      try {
        await budget.lockUncertainCharge({
          reservationId: reservation.reservationId,
          reason: scrubbedMessage,
          receiptPath: failurePath,
          receiptSha256,
        });
      } catch {
        // Reservation may already have been locked if normalizeRouteResponse threw after receipt write
      }
      throw new Error(`LIVE_TRANSPORT_UNCERTAIN_DO_NOT_REPLAY:${scrubbedMessage}`);
    }
  }
}
