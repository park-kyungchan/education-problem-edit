import { expect, test } from "bun:test";
import { createUnitManifest, invalidateFrom } from "../src/question";
import { addReviewIssue, createReviewOperation, decodeReviewOperation, needsInterview, planReview, proposeReviewCandidate, recordReviewDecision, resolveReviewIssue, type ArtifactPin, type ReviewIssue, type ReviewOperation } from "../src/review";

function units() {
  return [1, 2, 3].map(n => {
    const u = createUnitManifest({ sourceSha256: "a".repeat(64), questionId: `Q${n}`, physicalPage: 1, logicalOrder: n });
    u.contentRevision = `content-${n}`;
    u.stages.forEach(s => { s.state = "done"; s.outputRevision = `${n}-${s.stage}`; });
    return u;
  });
}
function fixture() {
  const us = units();
  const artifacts: ArtifactPin[] = ["document", "comparison", "verification"].map((role, n) => ({ role: role as ArtifactPin["role"], path: role === "document" ? "test.hwpx" : role,
    sha256: String(n + 1).repeat(64), url: role === "verification" ? null : "https://example.test/review" }));
  return { us, artifacts, observed: Object.fromEntries(artifacts.map(a => [a.path, a.sha256])), op: createReviewOperation("synthetic", us, ["Q1", "Q2"]) };
}
function accept(op: ReviewOperation, f: ReturnType<typeof fixture>) {
  return recordReviewDecision(op, { revision: op.candidates.at(-1)!.revision, decision: "accept", actor: "user", instruction: "Synthetic explicit approval" }, f.us, f.observed);
}
const issue: ReviewIssue = { id: "U1", questionId: "Q3", stage: "semantics", item: "unreadable label", location: "physical page 1 / Q3 / upper label", impact: "source-meaning", evidence: "Selected source crop cannot distinguish the two readings", conflictsWithDecision: false };

test("pilot and final approvals gate actual readiness; native unknown stays unknown", () => {
  const f = fixture();
  expect(planReview(f.op, f.us, f.observed).deliveryReady).toBe(false);
  expect(() => proposeReviewCandidate(f.op, "final", f.us, f.artifacts, "unknown", f.observed)).toThrow("pilot_required");
  let op = proposeReviewCandidate(f.op, "pilot", f.us, f.artifacts, "unknown", f.observed);
  expect(planReview(op, f.us, f.observed).scaleReady).toBe(false);
  op = accept(op, f);
  expect(planReview(op, f.us, f.observed).scaleReady).toBe(true);
  op = proposeReviewCandidate(op, "final", f.us, f.artifacts, "unknown", f.observed);
  expect(planReview(op, f.us, f.observed).deliveryReady).toBe(false);
  op = accept(op, f);
  expect(planReview(op, f.us, f.observed).deliveryReady).toBe(true);
  expect(planReview(op, f.us, f.observed).nativeVerified).toBe(false);
  expect(planReview(op, f.us, { ...f.observed, "test.hwpx": "f".repeat(64) }).deliveryReady).toBe(false);
});

test("meaning/conflicts require interview; evidenced minor presentation permits agent choice", () => {
  const f = fixture();
  let op = addReviewIssue(f.op, issue);
  expect(needsInterview(issue)).toBe(true);
  expect(() => resolveReviewIssue(op, { issueId: "U1", disposition: "reading", actor: "agent", instruction: "guess" })).toThrow("human_resolution_required");
  expect(() => resolveReviewIssue(op, { issueId: "U1", disposition: "presentation-choice", actor: "user", instruction: "relabel source uncertainty" })).toThrow("source_is_not_presentation");
  const minor = { ...issue, id: "F1", impact: "presentation" as const, item: "equivalent valid token spacing" };
  expect(needsInterview(minor)).toBe(false);
  expect(needsInterview({ ...minor, conflictsWithDecision: true })).toBe(true);
  op = addReviewIssue(op, minor);
  op = resolveReviewIssue(op, { issueId: "F1", disposition: "presentation-choice", actor: "agent", instruction: "Preserve the existing equivalent representation per L2" });
  expect(op.resolutions).toHaveLength(1);
});

test("unregistered unknown blocks; explicit authorized residual permits delivery without erasing unknown", () => {
  const f = fixture();
  let op = accept(proposeReviewCandidate(f.op, "pilot", f.us, f.artifacts, "unknown", f.observed), f);
  f.us[2].stages.find(s => s.stage === "semantics")!.unresolved.push(issue.item);
  expect(planReview(op, f.us, f.observed).final.blockers.join(" ")).toContain("unregistered unresolved");
  op = addReviewIssue(op, issue);
  expect(() => proposeReviewCandidate(op, "final", f.us, f.artifacts, "unknown", f.observed)).toThrow("content_blocked");
  op = resolveReviewIssue(op, { issueId: "U1", disposition: "authorized-residual", actor: "user", instruction: "Keep the label explicitly unknown in the delivered document" });
  op = accept(proposeReviewCandidate(op, "final", f.us, f.artifacts, "unknown", f.observed), f);
  const plan = planReview(op, f.us, f.observed);
  expect(plan.deliveryReady).toBe(true);
  expect(plan.residuals[0].issue.item).toBe(issue.item);
  expect(f.us[2].stages.find(s => s.stage === "semantics")!.unresolved).toEqual([issue.item]);
});

test("unrelated correction preserves pilot; dependent correction stales approvals and final", () => {
  const f = fixture();
  let op = accept(proposeReviewCandidate(f.op, "pilot", f.us, f.artifacts, "unknown", f.observed), f);
  op = accept(proposeReviewCandidate(op, "final", f.us, f.artifacts, "unknown", f.observed), f);
  f.us[2] = invalidateFrom(f.us[2], "geometry");
  expect(planReview(op, f.us, f.observed).scaleReady).toBe(true);
  expect(planReview(op, f.us, f.observed).deliveryReady).toBe(false);
  f.us[0].stages[1].outputRevision = "changed reading";
  expect(planReview(op, f.us, f.observed).scaleReady).toBe(false);
  expect(() => recordReviewDecision(op, { revision: op.candidates[0].revision, decision: "accept", actor: "user", instruction: "stale" }, f.us, f.observed)).toThrow("stale_approval_inputs");
});

test("latest user decision governs; history is retained; new candidate never inherits approval", () => {
  const f = fixture();
  let op = accept(proposeReviewCandidate(f.op, "pilot", f.us, f.artifacts, "unknown", f.observed), f);
  op = recordReviewDecision(op, { revision: op.candidates[0].revision, decision: "hold", actor: "user", instruction: "Reopen layout review" }, f.us, f.observed);
  expect(planReview(op, f.us, f.observed).scaleReady).toBe(false);
  expect(op.decisions).toHaveLength(2);
  const revised = f.artifacts.map(a => ({ ...a, sha256: "e".repeat(64) }));
  f.observed = Object.fromEntries(revised.map(a => [a.path, a.sha256]));
  op = proposeReviewCandidate(op, "pilot", f.us, revised, "unknown", f.observed);
  expect(planReview(op, f.us, f.observed).scaleReady).toBe(false);
  expect(op.candidates).toHaveLength(2);
  expect(() => recordReviewDecision(op, { revision: op.candidates[0].revision, decision: "accept", actor: "user", instruction: "old" }, f.us, f.observed)).toThrow("stale_decision_target");
});

test("admission rejects malformed events, missing pilot coverage, changed source and selection", () => {
  const f = fixture();
  for (const raw of [null, {}, { ...f.op, pilotQuestionIds: [] }, { ...f.op, issues: [null] }, { ...f.op, resolutions: [{ issueId: "absent" }] }]) {
    expect(() => decodeReviewOperation(raw)).toThrow();
  }
  const op = proposeReviewCandidate(f.op, "pilot", f.us, f.artifacts, "unknown", f.observed);
  expect(() => decodeReviewOperation({ ...op, candidates: [{ ...op.candidates[0], inputDigest: "0".repeat(64) }] })).toThrow("candidate_digest");
  expect(() => planReview(f.op, f.us.slice(0, 2), f.observed)).toThrow("selection_changed");
  f.us.forEach(u => { u.source.sourceSha256 = "b".repeat(64); });
  expect(() => planReview(f.op, f.us, f.observed)).toThrow("source_changed");
});
