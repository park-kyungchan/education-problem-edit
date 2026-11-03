import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import type { BudgetLedgerEntry, CanonicalDecisionResult } from "../contracts.ts";
import { loadAndVerifyBudgetAuthority, parseUsdStringToMicroUsd } from "./budget.ts";

// Superseding authority is separate from the preserved historical Argon policy.
export const RECOVERY_AUTHORITY = {
  schema: "math-editing.recovery-authority-amendment.v1",
  authorityInputIds: ["input-037", "input-038"],
  workId: "gpt-pipeline-takeover-20261020",
  taskId: "T-ARGON-RECOVERY",
  futurePaidCallOwner: "math-gpt-lead",
  liveCallsAdmitted: false,
  reason: "Worker is offline-only. Lead must separately record admission after budget reconciliation; historical Argon authority cannot authorize new calls.",
} as const;

export function assertRecoveryLiveAdmission(): void {
  throw new Error("LIVE_CALLS_HELD_AFTER_TAKEOVER:math-gpt-lead admission required; worker cannot read credentials, reserve or send");
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function safeMicro(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`INVALID_RECOVERY_MICRO_USD:${label}`);
  return value;
}
export interface ReceiptEvidence {
  path: string;
  sha256: string;
  generationId: string | null;
  requestBodySha256: string | null;
  actualMicroUsd: number | null;
  rawReportedCostUsd: string | null;
}
export interface SettlementCorroboration {
  generationId: string;
  requestBodySha256: string;
  actualMicroUsd: number | null;
}

/** Read-only audit. A missing/hash-mismatched settlement retains at least its
 * original ceiling even if a derived report corroborates the old settlement. */
export function reconcileLedgerEvidence(params: {
  entries: readonly BudgetLedgerEntry[];
  priorSpentMicroUsd: number;
  receipts: readonly ReceiptEvidence[];
  corroborations?: readonly SettlementCorroboration[];
}) {
  const prior = safeMicro(params.priorSpentMicroUsd, "prior");
  const latest = new Map<string, BudgetLedgerEntry>();
  const keys = new Map<string, string>();
  for (const entry of params.entries) {
    if (entry.schema !== "math-editing.budget-ledger-entry.v1") throw new Error("INVALID_LEDGER_SCHEMA");
    if (entry.eventKind === "prior-spend-baseline") {
      if (entry.actualMicroUsd !== prior) throw new Error("BASELINE_SPEND_MISMATCH");
      continue;
    }
    safeMicro(entry.reservedMicroUsd, "reserved");
    if (entry.actualMicroUsd !== null) safeMicro(entry.actualMicroUsd, "actual");
    const previous = latest.get(entry.reservationId);
    if (previous && (previous.requestKey !== entry.requestKey || previous.reservedMicroUsd !== entry.reservedMicroUsd || previous.status !== "active-reserved")) {
      throw new Error(`INVALID_RESERVATION_TRANSITION:${entry.reservationId}`);
    }
    if (!previous && (entry.eventKind !== "reservation-created" || entry.status !== "active-reserved")) throw new Error(`MISSING_RESERVATION_CREATION:${entry.reservationId}`);
    if (keys.has(entry.requestKey) && keys.get(entry.requestKey) !== entry.reservationId) throw new Error(`DUPLICATE_REQUEST_KEY:${entry.requestKey}`);
    keys.set(entry.requestKey, entry.reservationId);
    latest.set(entry.reservationId, entry);
  }
  let recordedSettledMicroUsd = prior;
  let directlyVerifiedSettledMicroUsd = prior;
  let activeReservedMicroUsd = 0;
  let uncertainLockedMicroUsd = 0;
  let auditHeldMicroUsd = 0;
  const generations = new Set<string>();
  const rows = [...latest.values()].map(entry => {
    let integrity: "verified-original-receipt" | "unresolved-original-receipt" | "unsettled" = "unsettled";
    let held = 0;
    let reportedCostUsd: string | null = null;
    let corroboratedByDerivedReport = false;
    const receipt = params.receipts.find(r => r.path === entry.receiptPath && r.sha256 === entry.receiptSha256);
    if (entry.status === "settled") {
      if (entry.actualMicroUsd === null) throw new Error(`SETTLED_COST_MISSING:${entry.reservationId}`);
      if (!entry.generationId || generations.has(entry.generationId)) throw new Error(`INVALID_OR_DUPLICATE_GENERATION:${entry.reservationId}`);
      generations.add(entry.generationId);
      recordedSettledMicroUsd += entry.actualMicroUsd;
      const requestHash = entry.requestKey.split(":").at(-1);
      if (receipt && receipt.generationId === entry.generationId && receipt.actualMicroUsd === entry.actualMicroUsd && receipt.requestBodySha256 === requestHash) {
        integrity = "verified-original-receipt";
        directlyVerifiedSettledMicroUsd += entry.actualMicroUsd;
        reportedCostUsd = receipt.rawReportedCostUsd;
      } else {
        integrity = "unresolved-original-receipt";
        held = Math.max(entry.reservedMicroUsd, entry.actualMicroUsd);
        // This is a supplement to recorded cost, never a ledger rewrite/release.
        auditHeldMicroUsd += held - entry.actualMicroUsd;
        corroboratedByDerivedReport = (params.corroborations ?? []).some(c => c.generationId === entry.generationId && c.requestBodySha256 === requestHash && c.actualMicroUsd === entry.actualMicroUsd);
      }
    } else if (entry.status === "active-reserved") activeReservedMicroUsd += entry.reservedMicroUsd;
    else if (entry.status === "uncertain-locked") uncertainLockedMicroUsd += entry.reservedMicroUsd;
    else if (entry.status === "aborted-before-send") {
      // Release only with explicit pre-send event, never from a missing response.
      if (entry.eventKind !== "reservation-released-precall-abort" || entry.actualMicroUsd !== 0) throw new Error(`INVALID_PRE_SEND_RELEASE:${entry.reservationId}`);
    } else throw new Error(`UNKNOWN_RESERVATION_STATUS:${entry.status}`);
    return { reservationId: entry.reservationId, requestKey: entry.requestKey, status: entry.status, reservedMicroUsd: entry.reservedMicroUsd, recordedActualMicroUsd: entry.actualMicroUsd, generationId: entry.generationId, originalReceiptPath: entry.receiptPath, expectedReceiptSha256: entry.receiptSha256, integrity, rawReportedCostUsd: reportedCostUsd, corroboratedByDerivedReport, retainedAuditCeilingMicroUsd: held };
  });
  const recordedCommittedMicroUsd = recordedSettledMicroUsd + activeReservedMicroUsd + uncertainLockedMicroUsd;
  const conservativeCommittedMicroUsd = recordedCommittedMicroUsd + auditHeldMicroUsd;
  return {
    schema: "math-editing.budget-reconciliation.v1",
    sessionCapMicroUsd: 10_000_000,
    priorSpentMicroUsd: prior,
    recordedSettledMicroUsd,
    directlyVerifiedSettledMicroUsd,
    activeReservedMicroUsd,
    uncertainLockedMicroUsd,
    auditSupplementalHoldMicroUsd: auditHeldMicroUsd,
    recordedCommittedMicroUsd,
    conservativeCommittedMicroUsd,
    recordedHeadroomMicroUsd: Math.max(0, 10_000_000 - recordedCommittedMicroUsd),
    auditableHeadroomMicroUsd: Math.max(0, 10_000_000 - conservativeCommittedMicroUsd),
    exceedsCap: conservativeCommittedMicroUsd > 10_000_000,
    unresolvedOriginalReceiptCount: rows.filter(r => r.integrity === "unresolved-original-receipt").length,
    rows,
    liveCallsAdmitted: false,
    billingInvoiceRequeried: false,
    acceptanceDecision: null,
  };
}

export async function auditSavedBudget(workspaceRoot: string) {
  const { priorCosts } = await loadAndVerifyBudgetAuthority(workspaceRoot);
  const ledgerPath = resolve(workspaceRoot, "argon-pipeline/budget-ledger.jsonl");
  // Missing ledger fails; it must never reset observed spend to the initial baseline.
  const ledgerBytes = await readFile(ledgerPath);
  const entries = ledgerBytes.toString("utf8").trim().split(/\r?\n/).map(line => JSON.parse(line) as BudgetLedgerEntry);
  const receipts: ReceiptEvidence[] = [];
  const evidencePins = [{path: ledgerPath, sha256: sha256(ledgerBytes)}];
  const paths = [...new Set(entries.flatMap(e => e.eventKind !== "prior-spend-baseline" && e.receiptPath ? [e.receiptPath] : []))];
  for (const path of paths) {
    const absolute = resolve(workspaceRoot, path);
    const local = relative(resolve(workspaceRoot, "dual-pipeline/evaluation/receipts"), absolute);
    if (local.startsWith("..") || isAbsolute(local)) throw new Error(`RECEIPT_OUTSIDE_AUDIT_BOUNDARY:${path}`);
    let bytes: Buffer;
    try { bytes = await readFile(absolute); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    const saved = JSON.parse(bytes.toString("utf8"));
    const gateway = saved.body?.provider_metadata?.gateway;
    const rawCost = typeof gateway?.cost === "string" ? gateway.cost : null;
    receipts.push({ path, sha256: sha256(bytes), generationId: gateway?.generationId ?? null, requestBodySha256: saved.requestBodySha256 ?? null, actualMicroUsd: rawCost === null ? null : parseUsdStringToMicroUsd(rawCost), rawReportedCostUsd: rawCost });
    evidencePins.push({path: absolute, sha256: sha256(bytes)});
  }
  const reportPath = resolve(workspaceRoot, "dual-pipeline/evaluation/live-pilot-comparison-report.json");
  const reportBytes = await readFile(reportPath);
  evidencePins.push({path: reportPath, sha256: sha256(reportBytes)});
  const report = JSON.parse(reportBytes.toString("utf8")) as {resultsByUnit: {jevResult: CanonicalDecisionResult; baselineResult: CanonicalDecisionResult}[]};
  const corroborations = report.resultsByUnit.flatMap(row => [row.jevResult, row.baselineResult]).map(r => ({generationId: r.generationId!, requestBodySha256: r.requestBodySha256, actualMicroUsd: r.cost.actualMicroUsd}));
  return {...reconcileLedgerEvidence({entries, priorSpentMicroUsd: priorCosts.totalMicroUsd, receipts, corroborations}), evidencePins, authority: RECOVERY_AUTHORITY};
}
