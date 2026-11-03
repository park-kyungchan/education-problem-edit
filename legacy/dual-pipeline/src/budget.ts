import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  type BudgetLedgerEntry,
  type BudgetSnapshot,
  type RouteExecutionConfig,
  type RouteModelId,
  SESSION_BUDGET_CONSTANTS,
  VERIFIED_MODEL_PRICING,
} from "../contracts.ts";

export interface PriorApiCostsFile {
  schema: "math-editing.prior-session-api-costs.v1";
  currency: "USD";
  rows: {
    path: string;
    sha256: string;
    reportedCostUsd: string;
    microUsd: number;
    field: string;
    accuracyEligible: boolean;
  }[];
  totalMicroUsd: number;
  totalReportedCostUsd: number;
  newPaidCallBudgetMicroUsd: number;
  includeInCombinedSessionCap: true;
  invalidFixtureChargesStillCount: true;
}

export interface PaidBudgetPolicyFile {
  schema: "math-editing.paid-api-budget-policy.v1";
  authorityInputId: "input-034";
  currency: "USD";
  sessionTotalCap: 10;
  paidCallOwner: "math-argon-lead";
  otherPaidCallOwnersAllowed: string[];
  sharedAcrossAllRoutesAndWorkers: true;
  ledger: string;
  reservationRequiredBeforeCall: true;
  unknownChargeRule: string;
  nativeSubscriptionQuotaSeparate: true;
  globalAccountBudgetModified: false;
}

const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._\-+/=]{8,}/gi,
  /\b(?:vck|sk|tsai|agw|key)_[A-Za-z0-9._\-]{8,}\b/g,
  /AI_GATEWAY_API_KEY\s*=\s*[^\s"']+/g,
];

export function redactSecrets(input: string, explicitSecrets: readonly string[] = []): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  for (const secret of explicitSecrets) {
    if (secret && secret.trim().length >= 4) {
      out = out.replaceAll(`Bearer ${secret.trim()}`, "[REDACTED]");
      out = out.replaceAll(secret, "[REDACTED]");
      out = out.replaceAll(secret.trim(), "[REDACTED]");
    }
  }
  return out;
}

export function parseUsdStringToMicroUsd(usdString: string): number {
  const trimmed = usdString.trim();
  if (!/^\d+(?:\.\d{1,9})?$/.test(trimmed)) {
    throw new Error(`INVALID_USD_COST_STRING:${trimmed}`);
  }
  const [wholePart = "0", fracPart = ""] = trimmed.split(".");
  const paddedNano = (fracPart + "000000000").slice(0, 9);
  const totalNanoUsd = BigInt(wholePart) * 1_000_000_000n + BigInt(paddedNano);
  // Ceiling conversion from nanoUSD to integer microUSD so we never undercount spend.
  const microUsd = (totalNanoUsd + 999n) / 1000n;
  const asNum = Number(microUsd);
  if (!Number.isSafeInteger(asNum) || asNum < 0) {
    throw new Error(`UNSAFE_MICRO_USD_VALUE:${trimmed}`);
  }
  return asNum;
}

export function computeReservationCeilingMicroUsd(config: RouteExecutionConfig): number {
  const pricing = VERIFIED_MODEL_PRICING[config.modelId];
  if (!pricing) {
    throw new Error(`UNVERIFIED_MODEL_PRICING:${String(config.modelId)}`);
  }
  if (
    !Number.isSafeInteger(config.maxInputTokensEstimate) ||
    config.maxInputTokensEstimate <= 0 ||
    config.maxInputTokensEstimate > pricing.contextWindowTokens
  ) {
    throw new Error(`INVALID_INPUT_TOKEN_BOUND:${config.maxInputTokensEstimate}`);
  }
  if (
    !Number.isSafeInteger(config.maxOutputTokens) ||
    config.maxOutputTokens < 0 ||
    config.maxOutputTokens > pricing.maxOutputTokens
  ) {
    throw new Error(`INVALID_OUTPUT_TOKEN_BOUND:${config.maxOutputTokens}`);
  }
  if (config.modelId !== "typesafe-ai/jev-1.14.0" && config.maxOutputTokens <= 0) {
    throw new Error(`GENERATIVE_ROUTE_REQUIRES_POSITIVE_MAX_OUTPUT_TOKENS:${config.maxOutputTokens}`);
  }
  if (config.maxRequestsPerInvocation !== 1) {
    throw new Error(`BOUNDED_SINGLE_REQUEST_REQUIRED:${String(config.maxRequestsPerInvocation)}`);
  }
  if (!Number.isSafeInteger(config.maxRetries) || config.maxRetries < 0 || config.maxRetries > 1) {
    throw new Error(`INVALID_RETRY_BOUND:${config.maxRetries}`);
  }

  const worstCaseInputRateNano = Math.max(
    pricing.inputNanoUsdPerToken,
    pricing.inputCacheWriteNanoUsdPerToken,
  );
  const perAttemptNanoUsd =
    config.maxInputTokensEstimate * worstCaseInputRateNano +
    config.maxOutputTokens * pricing.outputNanoUsdPerToken;
  const maxAttempts = 1 + config.maxRetries;
  const totalNanoUsd = perAttemptNanoUsd * maxAttempts;
  const ceilingMicroUsd = Math.ceil(totalNanoUsd / 1_000);
  if (!Number.isSafeInteger(ceilingMicroUsd) || ceilingMicroUsd <= 0) {
    throw new Error(`INVALID_COMPUTED_RESERVATION_MICRO_USD:${ceilingMicroUsd}`);
  }
  return ceilingMicroUsd;
}

export function computeCatalogEstimatedMicroUsd(
  modelId: RouteModelId,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
    cacheWriteInputTokens?: number;
  },
): number {
  const pricing = VERIFIED_MODEL_PRICING[modelId];
  const cachedRead = Math.max(0, usage.cachedInputTokens ?? 0);
  const cacheWrite = Math.max(0, usage.cacheWriteInputTokens ?? 0);
  const standardInput = Math.max(0, usage.inputTokens - cachedRead - cacheWrite);
  const totalNanoUsd =
    standardInput * pricing.inputNanoUsdPerToken +
    cacheWrite * pricing.inputCacheWriteNanoUsdPerToken +
    cachedRead * pricing.inputCacheReadNanoUsdPerToken +
    Math.max(0, usage.outputTokens) * pricing.outputNanoUsdPerToken;
  return Math.ceil(totalNanoUsd / 1_000);
}

export async function loadAndVerifyBudgetAuthority(workspaceRoot: string): Promise<{
  policy: PaidBudgetPolicyFile;
  priorCosts: PriorApiCostsFile;
}> {
  const policyPath = resolve(workspaceRoot, SESSION_BUDGET_CONSTANTS.budgetPolicyPath);
  const priorPath = resolve(workspaceRoot, SESSION_BUDGET_CONSTANTS.priorCostsPath);
  const [policyRaw, priorRaw] = await Promise.all([
    readFile(policyPath, "utf8"),
    readFile(priorPath, "utf8"),
  ]);
  const policy = JSON.parse(policyRaw) as PaidBudgetPolicyFile;
  const priorCosts = JSON.parse(priorRaw) as PriorApiCostsFile;

  if (
    policy.schema !== "math-editing.paid-api-budget-policy.v1" ||
    policy.sessionTotalCap !== 10 ||
    policy.paidCallOwner !== "math-argon-lead" ||
    policy.sharedAcrossAllRoutesAndWorkers !== true ||
    policy.reservationRequiredBeforeCall !== true
  ) {
    throw new Error("BUDGET_POLICY_CONTRACT_MISMATCH");
  }

  if (
    priorCosts.schema !== "math-editing.prior-session-api-costs.v1" ||
    priorCosts.totalMicroUsd !== SESSION_BUDGET_CONSTANTS.priorSpentMicroUsd ||
    priorCosts.newPaidCallBudgetMicroUsd !== SESSION_BUDGET_CONSTANTS.initialRemainingNewCallMicroUsd ||
    priorCosts.includeInCombinedSessionCap !== true ||
    priorCosts.invalidFixtureChargesStillCount !== true
  ) {
    throw new Error("PRIOR_COSTS_CONTRACT_MISMATCH");
  }

  let rowSum = 0;
  for (const row of priorCosts.rows) {
    const fileBytes = await readFile(resolve(workspaceRoot, row.path));
    const actualSha = createHash("sha256").update(fileBytes).digest("hex");
    if (actualSha !== row.sha256) {
      throw new Error(`PRIOR_COST_RECEIPT_HASH_DRIFT:${row.path}`);
    }
    const parsedMicro = parseUsdStringToMicroUsd(row.reportedCostUsd);
    if (parsedMicro !== row.microUsd) {
      throw new Error(`PRIOR_COST_ARITHMETIC_MISMATCH:${row.path}`);
    }
    rowSum += row.microUsd;
  }
  if (rowSum !== priorCosts.totalMicroUsd) {
    throw new Error(`PRIOR_COST_SUM_MISMATCH:${rowSum}!=${priorCosts.totalMicroUsd}`);
  }
  if (
    priorCosts.totalMicroUsd + priorCosts.newPaidCallBudgetMicroUsd !==
    SESSION_BUDGET_CONSTANTS.sessionTotalCapMicroUsd
  ) {
    throw new Error("SESSION_CAP_ARITHMETIC_MISMATCH");
  }

  return { policy, priorCosts };
}

interface ReservationState {
  reservationId: string;
  requestKey: string;
  callerOwner: string;
  routeId: RouteExecutionConfig["routeId"];
  modelId: RouteModelId;
  unitId: string;
  reservedMicroUsd: number;
  actualMicroUsd: number | null;
  status: "active-reserved" | "settled" | "uncertain-locked" | "aborted-before-send";
  generationId: string | null;
  receiptPath: string | null;
  receiptSha256: string | null;
}

/**
 * SharedBudgetLedger enforces a single session-wide US$10 (10,000,000 microUSD)
 * ceiling across all routes, models, and workers, starting with the 11,496 microUSD
 * already spent on four prior synthetic probes (including invalid contract-001).
 */
export class SharedBudgetLedger {
  private readonly sessionCapMicroUsd = SESSION_BUDGET_CONSTANTS.sessionTotalCapMicroUsd;
  private readonly priorSpentMicroUsd: number;
  private readonly ledgerFilePath: string | null;
  private readonly reservations = new Map<string, ReservationState>();
  private readonly requestKeyToReservationId = new Map<string, string>();
  private readonly entries: BudgetLedgerEntry[] = [];
  private readonly explicitSecrets: string[];

  constructor(options?: {
    priorSpentMicroUsd?: number;
    ledgerFilePath?: string | null;
    explicitSecrets?: string[];
  }) {
    const prior = options?.priorSpentMicroUsd ?? SESSION_BUDGET_CONSTANTS.priorSpentMicroUsd;
    if (prior < SESSION_BUDGET_CONSTANTS.priorSpentMicroUsd) {
      throw new Error(
        `PRIOR_SPEND_RESET_FORBIDDEN:${prior}<${SESSION_BUDGET_CONSTANTS.priorSpentMicroUsd}`,
      );
    }
    if (!Number.isSafeInteger(prior) || prior > this.sessionCapMicroUsd) {
      throw new Error(`INVALID_PRIOR_SPEND_MICRO_USD:${prior}`);
    }
    this.priorSpentMicroUsd = prior;
    this.ledgerFilePath = options?.ledgerFilePath ?? null;
    this.explicitSecrets = [...(options?.explicitSecrets ?? [])];

    const baselineEntry: BudgetLedgerEntry = {
      schema: "math-editing.budget-ledger-entry.v1",
      timestamp: new Date().toISOString(),
      eventKind: "prior-spend-baseline",
      reservationId: "prior-session-probes-0001-0004",
      requestKey: "prior:contract-001-and-contract-002",
      callerOwner: "math-argon-lead",
      routeId: "prior-synthetic-probes",
      modelId: "prior-combined",
      unitId: "contract-001+contract-002",
      reservedMicroUsd: this.priorSpentMicroUsd,
      actualMicroUsd: this.priorSpentMicroUsd,
      effectiveCommittedMicroUsd: this.priorSpentMicroUsd,
      cumulativeCommittedMicroUsd: this.priorSpentMicroUsd,
      remainingBudgetMicroUsd: this.sessionCapMicroUsd - this.priorSpentMicroUsd,
      sessionCapMicroUsd: 10_000_000,
      status: "settled",
      generationId: null,
      receiptPath: SESSION_BUDGET_CONSTANTS.priorCostsPath,
      receiptSha256: "2ab3167f18fb56aeb7f7e445ec9b2a94e0b3d4957da6b8b60c0fe8a7768be207",
      notes: "Four prior synthetic requests (including invalid fixture contract-001) charged 11,496 microUSD.",
    };
    this.entries.push(baselineEntry);
  }

  public static async fromExistingLedgerFile(
    ledgerFilePath: string,
    options?: { explicitSecrets?: string[] },
  ): Promise<SharedBudgetLedger> {
    const ledger = new SharedBudgetLedger({
      ledgerFilePath,
      explicitSecrets: options?.explicitSecrets,
    });
    try {
      const content = await readFile(ledgerFilePath, "utf8");
      const lines = content
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      for (const line of lines) {
        const entry = JSON.parse(line) as BudgetLedgerEntry;
        if (entry.eventKind === "prior-spend-baseline") continue;
        ledger.applyPersistedEntry(entry);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    return ledger;
  }

  private applyPersistedEntry(entry: BudgetLedgerEntry): void {
    if (
      entry.routeId === "prior-synthetic-probes" ||
      entry.modelId === "prior-combined"
    ) {
      return;
    }
    const state: ReservationState = {
      reservationId: entry.reservationId,
      requestKey: entry.requestKey,
      callerOwner: entry.callerOwner,
      routeId: entry.routeId,
      modelId: entry.modelId,
      unitId: entry.unitId,
      reservedMicroUsd: entry.reservedMicroUsd,
      actualMicroUsd: entry.actualMicroUsd,
      status: entry.status,
      generationId: entry.generationId,
      receiptPath: entry.receiptPath,
      receiptSha256: entry.receiptSha256,
    };
    this.reservations.set(entry.reservationId, state);
    this.requestKeyToReservationId.set(entry.requestKey, entry.reservationId);
    this.entries.push(entry);
  }

  public registerSecretForRedaction(secret: string): void {
    if (secret && secret.trim().length >= 4) {
      this.explicitSecrets.push(secret.trim());
    }
  }

  public getEntries(): readonly BudgetLedgerEntry[] {
    return this.entries;
  }

  public snapshot(): BudgetSnapshot {
    let activeReservedMicroUsd = 0;
    let settledNewMicroUsd = 0;
    let uncertainLockedMicroUsd = 0;
    const uncertainRequestKeys: string[] = [];
    const settledRequestKeys: string[] = [];

    for (const r of this.reservations.values()) {
      if (r.status === "active-reserved") {
        activeReservedMicroUsd += r.reservedMicroUsd;
      } else if (r.status === "settled") {
        settledNewMicroUsd += r.actualMicroUsd ?? r.reservedMicroUsd;
        settledRequestKeys.push(r.requestKey);
      } else if (r.status === "uncertain-locked") {
        uncertainLockedMicroUsd += r.reservedMicroUsd;
        uncertainRequestKeys.push(r.requestKey);
      }
    }

    const totalCommittedMicroUsd =
      this.priorSpentMicroUsd +
      activeReservedMicroUsd +
      settledNewMicroUsd +
      uncertainLockedMicroUsd;
    const remainingMicroUsd = Math.max(0, this.sessionCapMicroUsd - totalCommittedMicroUsd);

    return {
      schema: "math-editing.budget-snapshot.v1",
      sessionCapMicroUsd: 10_000_000,
      priorSpentMicroUsd: this.priorSpentMicroUsd,
      activeReservedMicroUsd,
      settledNewMicroUsd,
      uncertainLockedMicroUsd,
      totalCommittedMicroUsd,
      remainingMicroUsd,
      uncertainRequestKeys,
      settledRequestKeys,
    };
  }

  public async reserveBeforeCall(params: {
    requestKey: string;
    callerOwner: string;
    unitId: string;
    config: RouteExecutionConfig;
    overrideReservedMicroUsd?: number;
    notes?: string;
  }): Promise<BudgetLedgerEntry> {
    if (params.callerOwner !== SESSION_BUDGET_CONSTANTS.paidCallOwner) {
      throw new Error(
        `PAID_CALL_OWNER_REQUIRED:expected=${SESSION_BUDGET_CONSTANTS.paidCallOwner},got=${params.callerOwner}`,
      );
    }

    const existingId = this.requestKeyToReservationId.get(params.requestKey);
    if (existingId) {
      const existing = this.reservations.get(existingId)!;
      if (existing.status === "uncertain-locked") {
        throw new Error(`UNCERTAIN_REQUEST_REPLAY_FORBIDDEN:${params.requestKey}`);
      }
      if (existing.status === "settled") {
        throw new Error(`DUPLICATE_SETTLED_REQUEST_FORBIDDEN:${params.requestKey}`);
      }
      if (existing.status === "active-reserved") {
        throw new Error(`DUPLICATE_ACTIVE_RESERVATION_FORBIDDEN:${params.requestKey}`);
      }
    }

    const computedMicroUsd = computeReservationCeilingMicroUsd(params.config);
    const reservedMicroUsd = params.overrideReservedMicroUsd ?? computedMicroUsd;
    if (
      !Number.isSafeInteger(reservedMicroUsd) ||
      reservedMicroUsd <= 0 ||
      reservedMicroUsd < computedMicroUsd
    ) {
      throw new Error(
        `INVALID_RESERVATION_AMOUNT:${reservedMicroUsd}<computed=${computedMicroUsd}`,
      );
    }

    const current = this.snapshot();
    if (current.totalCommittedMicroUsd + reservedMicroUsd > this.sessionCapMicroUsd) {
      throw new Error(
        `BUDGET_CAP_EXCEEDED:committed=${current.totalCommittedMicroUsd}+reserve=${reservedMicroUsd}>cap=${this.sessionCapMicroUsd}`,
      );
    }

    const reservationId = `res_${randomUUID()}`;
    const state: ReservationState = {
      reservationId,
      requestKey: params.requestKey,
      callerOwner: params.callerOwner,
      routeId: params.config.routeId,
      modelId: params.config.modelId,
      unitId: params.unitId,
      reservedMicroUsd,
      actualMicroUsd: null,
      status: "active-reserved",
      generationId: null,
      receiptPath: null,
      receiptSha256: null,
    };
    this.reservations.set(reservationId, state);
    this.requestKeyToReservationId.set(params.requestKey, reservationId);

    const updated = this.snapshot();
    const entry: BudgetLedgerEntry = {
      schema: "math-editing.budget-ledger-entry.v1",
      timestamp: new Date().toISOString(),
      eventKind: "reservation-created",
      reservationId,
      requestKey: redactSecrets(params.requestKey, this.explicitSecrets),
      callerOwner: params.callerOwner,
      routeId: params.config.routeId,
      modelId: params.config.modelId,
      unitId: params.unitId,
      reservedMicroUsd,
      actualMicroUsd: null,
      effectiveCommittedMicroUsd: reservedMicroUsd,
      cumulativeCommittedMicroUsd: updated.totalCommittedMicroUsd,
      remainingBudgetMicroUsd: updated.remainingMicroUsd,
      sessionCapMicroUsd: 10_000_000,
      status: "active-reserved",
      generationId: null,
      receiptPath: null,
      receiptSha256: null,
      notes: redactSecrets(
        params.notes ?? "Pre-call ceiling microUSD reservation created.",
        this.explicitSecrets,
      ),
    };
    await this.recordEntry(entry);
    return entry;
  }

  public async settleActualCost(params: {
    reservationId: string;
    actualMicroUsd: number;
    generationId: string | null;
    receiptPath: string | null;
    receiptSha256: string | null;
    notes?: string;
  }): Promise<BudgetLedgerEntry> {
    const state = this.reservations.get(params.reservationId);
    if (!state) {
      throw new Error(`UNKNOWN_RESERVATION_ID:${params.reservationId}`);
    }
    if (state.status !== "active-reserved") {
      throw new Error(
        `CANNOT_SETTLE_NON_ACTIVE_RESERVATION:${params.reservationId}:${state.status}`,
      );
    }
    if (!Number.isSafeInteger(params.actualMicroUsd) || params.actualMicroUsd < 0) {
      throw new Error(`INVALID_ACTUAL_MICRO_USD:${params.actualMicroUsd}`);
    }

    const currentWithoutThisReserve =
      this.snapshot().totalCommittedMicroUsd - state.reservedMicroUsd;
    if (currentWithoutThisReserve + params.actualMicroUsd > this.sessionCapMicroUsd) {
      state.status = "uncertain-locked";
      state.reservedMicroUsd = params.actualMicroUsd;
      throw new Error(
        `ACTUAL_COST_EXCEEDED_SESSION_CAP:${currentWithoutThisReserve + params.actualMicroUsd}`,
      );
    }

    state.actualMicroUsd = params.actualMicroUsd;
    state.status = "settled";
    state.generationId = params.generationId;
    state.receiptPath = params.receiptPath;
    state.receiptSha256 = params.receiptSha256;

    const updated = this.snapshot();
    const entry: BudgetLedgerEntry = {
      schema: "math-editing.budget-ledger-entry.v1",
      timestamp: new Date().toISOString(),
      eventKind: "reservation-settled-actual",
      reservationId: state.reservationId,
      requestKey: redactSecrets(state.requestKey, this.explicitSecrets),
      callerOwner: state.callerOwner,
      routeId: state.routeId,
      modelId: state.modelId,
      unitId: state.unitId,
      reservedMicroUsd: state.reservedMicroUsd,
      actualMicroUsd: params.actualMicroUsd,
      effectiveCommittedMicroUsd: params.actualMicroUsd,
      cumulativeCommittedMicroUsd: updated.totalCommittedMicroUsd,
      remainingBudgetMicroUsd: updated.remainingMicroUsd,
      sessionCapMicroUsd: 10_000_000,
      status: "settled",
      generationId: params.generationId,
      receiptPath: params.receiptPath,
      receiptSha256: params.receiptSha256,
      notes: redactSecrets(
        params.notes ?? "Settled actual Gateway-reported cost in microUSD.",
        this.explicitSecrets,
      ),
    };
    await this.recordEntry(entry);
    return entry;
  }

  public async lockUncertainCharge(params: {
    reservationId: string;
    reason: string;
    receiptPath?: string | null;
    receiptSha256?: string | null;
  }): Promise<BudgetLedgerEntry> {
    const state = this.reservations.get(params.reservationId);
    if (!state) {
      throw new Error(`UNKNOWN_RESERVATION_ID:${params.reservationId}`);
    }
    if (state.status !== "active-reserved") {
      throw new Error(
        `CANNOT_LOCK_NON_ACTIVE_RESERVATION:${params.reservationId}:${state.status}`,
      );
    }

    state.status = "uncertain-locked";
    state.receiptPath = params.receiptPath ?? null;
    state.receiptSha256 = params.receiptSha256 ?? null;

    const updated = this.snapshot();
    const entry: BudgetLedgerEntry = {
      schema: "math-editing.budget-ledger-entry.v1",
      timestamp: new Date().toISOString(),
      eventKind: "reservation-locked-uncertain",
      reservationId: state.reservationId,
      requestKey: redactSecrets(state.requestKey, this.explicitSecrets),
      callerOwner: state.callerOwner,
      routeId: state.routeId,
      modelId: state.modelId,
      unitId: state.unitId,
      reservedMicroUsd: state.reservedMicroUsd,
      actualMicroUsd: null,
      effectiveCommittedMicroUsd: state.reservedMicroUsd,
      cumulativeCommittedMicroUsd: updated.totalCommittedMicroUsd,
      remainingBudgetMicroUsd: updated.remainingMicroUsd,
      sessionCapMicroUsd: 10_000_000,
      status: "uncertain-locked",
      generationId: null,
      receiptPath: state.receiptPath,
      receiptSha256: state.receiptSha256,
      notes: redactSecrets(
        `Uncertain outcome locked full reserve (${state.reservedMicroUsd} microUSD); replay forbidden: ${params.reason}`,
        this.explicitSecrets,
      ),
    };
    await this.recordEntry(entry);
    return entry;
  }

  public async abortBeforeSend(params: {
    reservationId: string;
    reason: string;
  }): Promise<BudgetLedgerEntry> {
    const state = this.reservations.get(params.reservationId);
    if (!state || state.status !== "active-reserved") {
      throw new Error(`INVALID_PRECALL_ABORT:${params.reservationId}`);
    }
    state.status = "aborted-before-send";
    const updated = this.snapshot();
    const entry: BudgetLedgerEntry = {
      schema: "math-editing.budget-ledger-entry.v1",
      timestamp: new Date().toISOString(),
      eventKind: "reservation-released-precall-abort",
      reservationId: state.reservationId,
      requestKey: redactSecrets(state.requestKey, this.explicitSecrets),
      callerOwner: state.callerOwner,
      routeId: state.routeId,
      modelId: state.modelId,
      unitId: state.unitId,
      reservedMicroUsd: state.reservedMicroUsd,
      actualMicroUsd: 0,
      effectiveCommittedMicroUsd: 0,
      cumulativeCommittedMicroUsd: updated.totalCommittedMicroUsd,
      remainingBudgetMicroUsd: updated.remainingMicroUsd,
      sessionCapMicroUsd: 10_000_000,
      status: "aborted-before-send",
      generationId: null,
      receiptPath: null,
      receiptSha256: null,
      notes: redactSecrets(
        `Pre-send validation aborted before network transmission: ${params.reason}`,
        this.explicitSecrets,
      ),
    };
    await this.recordEntry(entry);
    return entry;
  }

  private async recordEntry(entry: BudgetLedgerEntry): Promise<void> {
    this.entries.push(entry);
    if (this.ledgerFilePath) {
      await mkdir(dirname(this.ledgerFilePath), { recursive: true });
      await appendFile(this.ledgerFilePath, JSON.stringify(entry) + "\n", "utf8");
    }
  }
}

// Additive native-current-owner APIs; original module prefix above is byte-identical.
export { reconcileNativeOwner as reconcileCurrentNativeOwner, checkReservation as checkProgressiveReservation } from "./progressive/admission.ts";
