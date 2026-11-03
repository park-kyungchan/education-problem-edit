/** Filesystem/process adapter for the portable HITL policy. JSON out; no in-place writes. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { decodeUnitManifest } from "./question";
import { addReviewIssue, createReviewOperation, decodeReviewOperation, planReview, proposeReviewCandidate, recordReviewDecision, resolveReviewIssue, type ArtifactPin, type ReviewOperation, type ReviewKind } from "./review";

function need(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(`review_${code}@src/review-cli.ts:1`); }
function json(path: string): any {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("review_json_input@src/review-cli.ts:10: unreadable or malformed JSON"); }
}
function sha(path: string): string {
  try { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
  catch { throw new Error("review_artifact_read@src/review-cli.ts:14: artifact unreadable"); }
}
function pairs(args: string[], allowed: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    need(allowed.includes(args[i]) && !(args[i] in out) && args[i + 1] && !args[i + 1].startsWith("--"), "argument");
    out[args[i]] = args[i + 1];
  }
  for (const flag of allowed) need(out[flag], `missing_${flag.slice(2).replaceAll("-", "_")}`);
  return out;
}
function loadUnits(paths: string) { return paths.split(",").map(p => decodeUnitManifest(json(p.trim()))); }
function observations(op: ReviewOperation): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of op.candidates) for (const a of c.artifacts) {
    try { out[a.path] = sha(a.path); } catch { /* Missing artifact remains absent, never trusted. */ }
  }
  return out;
}
interface OracleOutput {
  checks: { name: string; status: "passed" }[];
  native: { status: "unknown" | "passed"; evidence?: string | null };
}
function verification(value: any): OracleOutput {
  need(value && Array.isArray(value.checks) && value.checks.length > 0, "verification_checks");
  need(value.checks.every((c: any) => c && typeof c.name === "string" && c.name.trim() && c.status === "passed"), "verification_failed");
  need(value.native && ["unknown", "passed"].includes(value.native.status), "native_status");
  need(value.native.status !== "passed" || (typeof value.native.evidence === "string" && value.native.evidence.trim()), "native_evidence");
  return value;
}

export function runReviewCli(args: string[]): unknown {
  const cmd = args[0];
  if (cmd === "new") {
    const v = pairs(args.slice(1), ["--operation", "--units", "--pilot"]);
    return createReviewOperation(v["--operation"], loadUnits(v["--units"]), v["--pilot"].split(",").map(s => s.trim()));
  }
  if (cmd === "check") {
    const v = pairs(args.slice(1), ["--document", "--oracle"]);
    const document = resolve(v["--document"]), oracle = resolve(v["--oracle"]);
    const before = sha(document), oracleBefore = sha(oracle);
    // The explicit local oracle is the only executed program; source text never supplies commands.
    const result = spawnSync("python3", [oracle, document], { encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024 });
    need(!result.error && result.status === 0, "oracle_execution_failed");
    let output: unknown;
    try { output = JSON.parse(result.stdout); }
    catch { throw new Error("review_oracle_json@src/review-cli.ts:1: oracle must return structured checks"); }
    const checked = verification(output);
    need(sha(document) === before && sha(oracle) === oracleBefore, "changed_during_verification");
    return { schema: "problem-edit.artifact-verification.v1", documentSha256: before,
      oracle: { path: oracle, sha256: oracleBefore }, checks: checked.checks, native: checked.native };
  }
  if (cmd === "plan" || cmd === "release") {
    const v = pairs(args.slice(1), ["--file", "--units"]);
    const op = decodeReviewOperation(json(v["--file"]));
    const plan = planReview(op, loadUnits(v["--units"]), observations(op));
    if (cmd === "release") {
      need(plan.deliveryReady, "delivery_blocked");
      return { ...plan, operationId: op.operationId, sourceSha256: op.sourceSha256,
        questionIds: op.questionIds, candidate: op.candidates.findLast(c => c.kind === "final") };
    }
    return plan;
  }
  if (cmd === "decide") {
    const v = pairs(args.slice(1), ["--file", "--event", "--units"]);
    const op = decodeReviewOperation(json(v["--file"]));
    return recordReviewDecision(op, json(v["--event"]), loadUnits(v["--units"]), observations(op));
  }
  if (["issue", "resolve"].includes(cmd)) {
    const v = pairs(args.slice(1), ["--file", "--event"]);
    const op = decodeReviewOperation(json(v["--file"])), event = json(v["--event"]);
    if (cmd === "issue") return addReviewIssue(op, event);
    return resolveReviewIssue(op, event);
  }
  if (cmd === "candidate") {
    const v = pairs(args.slice(1), ["--file", "--units", "--kind", "--document", "--comparison", "--verification", "--document-url", "--comparison-url"]);
    const op = decodeReviewOperation(json(v["--file"]));
    const artifacts: ArtifactPin[] = (["document", "comparison", "verification"] as const).map(role => {
      const path = resolve(v[`--${role}`]);
      return { role, path, sha256: sha(path), url: role === "verification" ? null : v[`--${role}-url`] };
    });
    const report = json(v["--verification"]);
    need(report?.schema === "problem-edit.artifact-verification.v1", "verification_schema");
    verification(report);
    need(report.documentSha256 === artifacts.find(a => a.role === "document")!.sha256, "verification_subject_changed");
    need(report.oracle && sha(report.oracle.path) === report.oracle.sha256, "oracle_changed");
    const observed = observations(op);
    for (const a of artifacts) observed[a.path] = sha(a.path);
    return proposeReviewCandidate(op, v["--kind"] as ReviewKind, loadUnits(v["--units"]), artifacts, report.native.status, observed);
  }
  throw new Error("review_usage@src/review-cli.ts:1: new|issue|resolve|check|candidate|decide|plan|release; see docs/hitl-review-contract.md");
}
