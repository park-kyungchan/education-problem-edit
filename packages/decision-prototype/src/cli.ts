import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { assertRecord } from "/LOCAL_HOME/projects/agent-platform/packages/work-continuity/src/git-work/records.ts";
import {
  type DecisionTaskUnit,
  HARNESS_IDENTITIES,
  type JevEndpointTransportKind,
  type RouteId,
  SESSION_BUDGET_CONSTANTS,
  VERIFIED_MODEL_PRICING,
} from "../contracts.ts";
import {
  computeReservationCeilingMicroUsd,
  loadAndVerifyBudgetAuthority,
  SharedBudgetLedger,
} from "./budget.ts";
import {
  compareBothRoutesOnUnits,
  prepareRouteExecutionOnUnit,
  runSingleRouteOnUnit,
} from "./compare.ts";
import {
  ALL_EVALUATION_UNITS,
  PILOT_MC_01_UNIT,
  PILOT_MC_02_UNIT,
  PILOT_MC_03_HELD_UNIT,
  SYNTHETIC_CONTRACT_001_EXCLUDED_UNIT,
  SYNTHETIC_CONTRACT_002_UNIT,
} from "./fixtures.ts";
import { defaultRouteConfig } from "./routes.ts";
import { auditSavedBudget, RECOVERY_AUTHORITY } from "./recovery.ts";
import {
  getOptionalGenerativeStageSpec,
  verifyAndLoadTaskUnitImages,
} from "./stages.ts";
import {
  FakeDeterministicTransport,
  LiveGatewayTransport,
  SavedArtifactReplayTransport,
} from "./transport.ts";

const WORKSPACE_ROOT = resolve(import.meta.dir, "../..");

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function selectUnits(caseSelector: string): DecisionTaskUnit[] {
  if (caseSelector === "all") {
    return [SYNTHETIC_CONTRACT_002_UNIT, PILOT_MC_01_UNIT, PILOT_MC_02_UNIT];
  }
  const unit = ALL_EVALUATION_UNITS[caseSelector];
  if (!unit) {
    throw new Error(
      `UNKNOWN_EVALUATION_CASE:${caseSelector}. Allowed: all, ${Object.keys(ALL_EVALUATION_UNITS).join(", ")}`,
    );
  }
  return [unit];
}

export async function runVerifyContracts(workspaceRoot = WORKSPACE_ROOT): Promise<{
  ok: true;
  checkedSpecCount: number;
  checkedPlanCount: number;
  checkedSeedRecordCount: number;
  pinnedEvidenceCount: number;
  verifiedUnitIds: string[];
  problem3HoldVerified: true;
}> {
  const [specRaw, planRaw, seedRaw] = await Promise.all([
    readFile(resolve(workspaceRoot, "dual-pipeline/spec.json"), "utf8"),
    readFile(resolve(workspaceRoot, "dual-pipeline/plan.json"), "utf8"),
    readFile(resolve(workspaceRoot, "argon-pipeline/harness-seed.json"), "utf8"),
  ]);

  const specDoc = JSON.parse(specRaw) as {
    commonHarnessSpecs: unknown[];
    pinnedEvidenceSources: { path: string; sha256: string }[];
  };
  const planDoc = JSON.parse(planRaw) as {
    commonHarnessPlans: unknown[];
  };
  const seedDoc = JSON.parse(seedRaw) as {
    records: unknown[];
  };

  for (const s of specDoc.commonHarnessSpecs) assertRecord(s);
  for (const p of planDoc.commonHarnessPlans) assertRecord(p);
  for (const r of seedDoc.records) assertRecord(r);

  for (const pin of specDoc.pinnedEvidenceSources) {
    const bytes = await readFile(resolve(workspaceRoot, pin.path));
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== pin.sha256) {
      throw new Error(`SPEC_EVIDENCE_HASH_DRIFT:${pin.path}:${actual}!=${pin.sha256}`);
    }
  }

  await loadAndVerifyBudgetAuthority(workspaceRoot);

  const verifiedUnitIds: string[] = [];
  for (const unit of [
    SYNTHETIC_CONTRACT_002_UNIT,
    SYNTHETIC_CONTRACT_001_EXCLUDED_UNIT,
    PILOT_MC_01_UNIT,
    PILOT_MC_02_UNIT,
  ]) {
    await verifyAndLoadTaskUnitImages(unit, workspaceRoot);
    verifiedUnitIds.push(unit.unitId);
  }

  let problem3Rejected = false;
  try {
    await verifyAndLoadTaskUnitImages(PILOT_MC_03_HELD_UNIT, workspaceRoot);
  } catch (error) {
    if ((error as Error).message.startsWith("HOLD_PROBLEM_03:")) {
      problem3Rejected = true;
    } else {
      throw error;
    }
  }
  if (!problem3Rejected) {
    throw new Error("PROBLEM_03_HOLD_GUARD_DID_NOT_FIRE");
  }

  return {
    ok: true,
    checkedSpecCount: specDoc.commonHarnessSpecs.length,
    checkedPlanCount: planDoc.commonHarnessPlans.length,
    checkedSeedRecordCount: seedDoc.records.length,
    pinnedEvidenceCount: specDoc.pinnedEvidenceSources.length,
    verifiedUnitIds,
    problem3HoldVerified: true,
  };
}

async function main(): Promise<void> {
  const command = Bun.argv[2] ?? "status";
  if (command === "progressive") {
    const { progressiveCli } = await import("./progressive/cli.ts");
    console.log(await progressiveCli(Bun.argv.slice(3)));
    return;
  }
  const flags = parseFlags(Bun.argv.slice(3));

  if (command === "audit-budget") {
    console.log(JSON.stringify(await auditSavedBudget(WORKSPACE_ROOT), null, 2));
    return;
  }

  if (command === "status") {
    const { policy, priorCosts } = await loadAndVerifyBudgetAuthority(WORKSPACE_ROOT);
    const ledgerPath = resolve(
      WORKSPACE_ROOT,
      typeof flags.ledger === "string"
        ? flags.ledger
        : SESSION_BUDGET_CONSTANTS.defaultLedgerPath,
    );
    const budget = await SharedBudgetLedger.fromExistingLedgerFile(ledgerPath);
    console.log(
      JSON.stringify(
        {
          schema: "math-editing.dual-pipeline-status.v1",
          harnessIdentities: HARNESS_IDENTITIES,
          budgetPolicy: {
            authorityInputId: policy.authorityInputId,
            paidCallOwner: policy.paidCallOwner,
            sessionTotalCapUsd: policy.sessionTotalCap,
            priorProbesCount: priorCosts.rows.length,
          },
          budgetSnapshot: budget.snapshot(),
          recoveryAuthority: RECOVERY_AUTHORITY,
          reconciledBudget: await auditSavedBudget(WORKSPACE_ROOT),
          verifiedPricing: VERIFIED_MODEL_PRICING,
          optionalGenerativeStage: getOptionalGenerativeStageSpec(),
          availableUnits: Object.keys(ALL_EVALUATION_UNITS),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "verify-contracts") {
    const verification = await runVerifyContracts(WORKSPACE_ROOT);
    console.log(
      JSON.stringify(
        {
          schema: "math-editing.dual-pipeline-contract-verification.v1",
          verifiedAt: new Date().toISOString(),
          ...verification,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "replay-probes") {
    await loadAndVerifyBudgetAuthority(WORKSPACE_ROOT);
    const budget = new SharedBudgetLedger();
    const transport = new SavedArtifactReplayTransport();
    const report = await compareBothRoutesOnUnits({
      units: [SYNTHETIC_CONTRACT_001_EXCLUDED_UNIT, SYNTHETIC_CONTRACT_002_UNIT],
      transport,
      budget,
      workspaceRoot: WORKSPACE_ROOT,
    });
    if (typeof flags.output === "string") {
      const outPath = resolve(WORKSPACE_ROOT, flags.output);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    }
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (command === "dry-run") {
    await loadAndVerifyBudgetAuthority(WORKSPACE_ROOT);
    const routeFlag = typeof flags.route === "string" ? flags.route : "both";
    const caseFlag = typeof flags.case === "string" ? flags.case : "all";
    const jevTransportKind: JevEndpointTransportKind =
      flags["jev-transport"] === "gateway-typesafe-systemone-compat"
        ? "gateway-typesafe-systemone-compat"
        : "gateway-openai-decisions";
    const baselineModelId: "openai/gpt-6.1-sol" | "google/gemini-2.5-pro" =
      flags.route === "gemini-2.5-pro" || flags["baseline-model"] === "google/gemini-2.5-pro"
        ? "google/gemini-2.5-pro"
        : "openai/gpt-6.1-sol";

    const units = selectUnits(caseFlag);
    const routesToInspect: RouteId[] =
      routeFlag === "jev-1.14" || routeFlag === "systemone-jev-1.14"
        ? ["systemone-jev-1.14"]
        : routeFlag === "gpt-6.1-sol" ||
            routeFlag === "gemini-2.5-pro" ||
            routeFlag === "gpt-gemini-baseline"
          ? ["gpt-gemini-baseline"]
          : ["systemone-jev-1.14", "gpt-gemini-baseline"];

    const preparedManifests = [];
    for (const unit of units) {
      for (const routeId of routesToInspect) {
        const cfg = defaultRouteConfig(routeId, {
          baselineModelId,
          jevTransportKind,
        });
        const prepared = await prepareRouteExecutionOnUnit({
          unit,
          config: cfg,
          workspaceRoot: WORKSPACE_ROOT,
        });
        const ceilingMicroUsd = computeReservationCeilingMicroUsd(cfg);
        preparedManifests.push({
          unitId: unit.unitId,
          problemContentId: unit.problemContentId,
          routeId: cfg.routeId,
          modelId: cfg.modelId,
          endpoint: prepared.endpoint,
          headers: prepared.headers,
          inputImageSha256List: prepared.inputImageSha256List,
          requestBodySha256: prepared.bodySha256,
          requestKey: prepared.requestKey,
          reservedCeilingMicroUsd: ceilingMicroUsd,
          accuracyEligible: unit.referenceProvenance.accuracyEligible,
          sourceUncertaintiesCount: unit.sourceUncertainties.length,
        });
      }
    }

    const fakeBudget = new SharedBudgetLedger();
    const fakeTransport = new FakeDeterministicTransport();
    const simulatedComparison =
      routesToInspect.length === 2
        ? await compareBothRoutesOnUnits({
            units,
            transport: fakeTransport,
            budget: fakeBudget,
            workspaceRoot: WORKSPACE_ROOT,
            baselineModelId,
            jevTransportKind,
          })
        : null;

    console.log(
      JSON.stringify(
        {
          schema: "math-editing.dual-pipeline-dry-run.v1",
          observedAt: new Date().toISOString(),
          networkCallsExecuted: 0,
          credentialsRead: false,
          preparedManifests,
          simulatedOfflineComparisonSummary: simulatedComparison?.summary ?? null,
          simulatedBudgetAfterDryRun: fakeBudget.snapshot(),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "evaluate") {
    const isLive = flags.live === true || flags.live === "true";
    const callerOwner =
      typeof flags["caller-owner"] === "string"
        ? flags["caller-owner"]
        : "argon-dual-builder";
    const routeFlag = typeof flags.route === "string" ? flags.route : "both";
    const caseFlag =
      typeof flags.case === "string" ? flags.case : "synthetic-contract-002";
    const jevTransportKind: JevEndpointTransportKind =
      flags["jev-transport"] === "gateway-typesafe-systemone-compat"
        ? "gateway-typesafe-systemone-compat"
        : "gateway-openai-decisions";
    const baselineModelId: "openai/gpt-6.1-sol" | "google/gemini-2.5-pro" =
      flags.route === "gemini-2.5-pro" || flags["baseline-model"] === "google/gemini-2.5-pro"
        ? "google/gemini-2.5-pro"
        : "openai/gpt-6.1-sol";

    await loadAndVerifyBudgetAuthority(WORKSPACE_ROOT);
    const units = selectUnits(caseFlag);

    const ledgerPath =
      isLive && typeof flags.ledger === "string"
        ? resolve(WORKSPACE_ROOT, flags.ledger)
        : isLive
          ? resolve(WORKSPACE_ROOT, SESSION_BUDGET_CONSTANTS.defaultLedgerPath)
          : null;

    const budget = ledgerPath
      ? await SharedBudgetLedger.fromExistingLedgerFile(ledgerPath)
      : new SharedBudgetLedger();

    const transport = isLive
      ? new LiveGatewayTransport()
      : flags.replay === true
        ? new SavedArtifactReplayTransport()
        : new FakeDeterministicTransport();

    if (
      routeFlag === "jev-1.14" ||
      routeFlag === "systemone-jev-1.14" ||
      routeFlag === "gpt-6.1-sol" ||
      routeFlag === "gemini-2.5-pro" ||
      routeFlag === "gpt-gemini-baseline"
    ) {
      const singleRouteId: RouteId =
        routeFlag === "jev-1.14" || routeFlag === "systemone-jev-1.14"
          ? "systemone-jev-1.14"
          : "gpt-gemini-baseline";
      const results = [];
      for (const unit of units) {
        const res = await runSingleRouteOnUnit({
          unit,
          routeId: singleRouteId,
          transport,
          budget,
          workspaceRoot: WORKSPACE_ROOT,
          callerOwner,
          baselineModelId,
          jevTransportKind,
        });
        results.push(res);
      }
      const payload = {
        schema: "math-editing.dual-route-single-evaluation.v1",
        generatedAt: new Date().toISOString(),
        transportMode: transport.mode,
        routeId: singleRouteId,
        results,
        budgetAfterRun: budget.snapshot(),
        winnerSelected: null,
        hitlGateReductionEstablished: false,
        acceptanceDecision: null,
      };
      if (typeof flags.output === "string") {
        const outPath = resolve(WORKSPACE_ROOT, flags.output);
        await mkdir(dirname(outPath), { recursive: true });
        await writeFile(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
      }
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    const report = await compareBothRoutesOnUnits({
      units,
      transport,
      budget,
      workspaceRoot: WORKSPACE_ROOT,
      callerOwner,
      baselineModelId,
      jevTransportKind,
      taskId: isLive ? "T-DUAL-EVALUATE" : "T-DUAL-IMPLEMENT",
    });
    if (typeof flags.output === "string") {
      const outPath = resolve(WORKSPACE_ROOT, flags.output);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    }
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  throw new Error(
    `UNKNOWN_COMMAND:${command}. Supported commands: status, audit-budget, verify-contracts, replay-probes, dry-run, evaluate`,
  );
}

if (import.meta.main) {
  await main();
}
