import { expect, test } from "bun:test";
import parity from "./fixtures/question-parity.json";
import {
  createUnitManifest,
  downstreamOf,
  invalidateFrom,
  parseQuestionId,
  parseUnitSelection,
  planAssembly,
  planUnitWork,
  validateUnitManifest,
  type QuestionUnitManifest,
} from "../src/question";

const SHA = "a".repeat(64);

function doneManifest(questionId = "Q3"): QuestionUnitManifest {
  const m = createUnitManifest({ sourceSha256: SHA, questionId, physicalPage: 2, logicalOrder: 3 });
  for (const rec of m.stages) {
    rec.state = "done";
    rec.inputRevision = "in-1";
    rec.outputRevision = `out-${rec.stage}`;
  }
  m.contentRevision = "content-1";
  return m;
}

test("question ids normalize Korean and bare forms", () => {
  expect(parseQuestionId("3")).toBe("Q3");
  expect(parseQuestionId("q03")).toBe("Q3");
  expect(parseQuestionId("문항 3")).toBe("Q3");
  expect(parseQuestionId("문제 7번")).toBe("Q7");
  expect(parseQuestionId("객관식 3번")).toBe("Q3");
  expect(parseQuestionId("서답형 2")).toBe("Q102");
  expect(parseQuestionId("서술형 4번")).toBe("Q104");
  expect(parseQuestionId("S2")).toBe("Q102");
  expect(parseQuestionId("s03")).toBe("Q103");
  expect(parseQuestionId("Q102")).toBe("Q102");
  expect(() => parseQuestionId("Q0")).toThrow();
  expect(() => parseQuestionId("S0")).toThrow();
  expect(() => parseQuestionId("abc")).toThrow();
});

test("unit selection: single, subset, range and bounded all", () => {
  expect(parseUnitSelection("Q3")).toEqual({ kind: "single", questionIds: ["Q3"] });
  expect(parseUnitSelection("Q7,Q3").questionIds).toEqual(["Q3", "Q7"]);
  expect(parseUnitSelection("Q3-Q5").questionIds).toEqual(["Q3", "Q4", "Q5"]);
  expect(parseUnitSelection("S2-S4").questionIds).toEqual(["Q102", "Q103", "Q104"]);
  expect(parseUnitSelection("객관식 2, 서답형 2, 서답형 4").questionIds).toEqual(["Q2", "Q102", "Q104"]);
  expect(parseUnitSelection("all", ["Q2", "Q1"]).questionIds).toEqual(["Q1", "Q2"]);
  expect(() => parseUnitSelection("all")).toThrow();
  expect(() => parseUnitSelection("Q9", ["Q1", "Q2"])).toThrow();
  expect(() => parseUnitSelection("Q5-Q3")).toThrow();
});

test("manifest creation validates source identity and crop", () => {
  const m = createUnitManifest({ sourceSha256: SHA, questionId: "3", physicalPage: 2, crop: [0, 0, 0.5, 0.5] });
  expect(m.questionId).toBe("Q3");
  expect(m.stages).toHaveLength(7);
  expect(validateUnitManifest(m)).toEqual([]);
  expect(() => createUnitManifest({ sourceSha256: "xyz", questionId: "Q1", physicalPage: 1 })).toThrow();
  expect(() => createUnitManifest({ sourceSha256: SHA, questionId: "Q1", physicalPage: 0 })).toThrow();
  expect(() => createUnitManifest({ sourceSha256: SHA, questionId: "Q1", physicalPage: 1, crop: [0.5, 0, 0.4, 1] })).toThrow();
});

test("fresh unit plans regions first and is not deliverable", () => {
  const plan = planUnitWork(createUnitManifest({ sourceSha256: SHA, questionId: "Q1", physicalPage: 1 }));
  expect(plan.runnable).toEqual(["regions"]);
  expect(plan.deliverable).toBe(false);
  expect(planUnitWork(doneManifest()).deliverable).toBe(true);
});

test("selective invalidation only stales the affected branch", () => {
  expect(downstreamOf("transcription")).toEqual(["semantics", "geometry", "assets", "equations", "question-layout"]);
  const after = invalidateFrom(doneManifest(), "geometry");
  const state = (s: string) => after.stages.find((r) => r.stage === s)?.state;
  expect(state("regions")).toBe("done");
  expect(state("transcription")).toBe("done");
  expect(state("equations")).toBe("done");
  expect(state("geometry")).toBe("stale");
  expect(state("assets")).toBe("stale");
  expect(state("question-layout")).toBe("stale");
  expect(after.contentRevision).toBeNull();
});

test("assembly requires one source, unique questions, logical order", () => {
  const a = doneManifest("Q7");
  a.source.logicalOrder = 7;
  const b = doneManifest("Q3");
  const plan = planAssembly([a, b]);
  expect(plan.questionIds).toEqual(["Q3", "Q7"]);
  expect(plan.ready).toEqual(["Q3", "Q7"]);
  expect(() => planAssembly([a, a])).toThrow();
  const other = doneManifest("Q1");
  other.source.sourceSha256 = "b".repeat(64);
  expect(() => planAssembly([b, other])).toThrow();
  expect(() => planAssembly([])).toThrow();
});

test("frozen parity vectors match the portable core", () => {
  for (const v of parity.vectors) {
    if (v.fn === "parseQuestionId") expect(parseQuestionId(v.input)).toBe(v.expected as string);
    else if (v.fn === "parseUnitSelection") expect(parseUnitSelection(v.input).questionIds).toEqual(v.expected as string[]);
    else if (v.fn === "downstreamOf") expect(downstreamOf(v.input as never)).toEqual(v.expected as string[]);
    else throw new Error(`Unknown parity fn: ${v.fn}`);
  }
});

test("stale ancestor blocks delivery even when layout is done", () => {
  const m = doneManifest();
  const sem = m.stages.find((r) => r.stage === "semantics")!;
  sem.state = "stale";
  sem.outputRevision = null;
  expect(validateUnitManifest(m)).toEqual([]);
  const plan = planUnitWork(m);
  expect(plan.deliverable).toBe(false);
  expect(plan.blockers.join(" ")).toContain("semantics");
  expect(planAssembly([m]).ready).toEqual([]);
});

test("invalid manifests are rejected by planning and assembly, not just validate", () => {
  const missing = doneManifest();
  missing.stages = missing.stages.filter((r) => r.stage === "question-layout");
  expect(validateUnitManifest(missing).length).toBeGreaterThan(0);
  expect(() => planUnitWork(missing)).toThrow("Invalid unit manifest");
  expect(() => planAssembly([missing])).toThrow("Invalid unit manifest");
  const badSchema = doneManifest();
  (badSchema as { schema: string }).schema = "wrong";
  expect(() => planUnitWork(badSchema)).toThrow("Invalid unit manifest");
  const badCrop = doneManifest();
  (badCrop.source as { crop: unknown }).crop = { space: "pixels", xyxy: [-1, 0, 2, 1] };
  expect(validateUnitManifest(badCrop).join(" ")).toContain("crop");
  const badState = doneManifest();
  (badState.stages[0] as { state: string }).state = "BANANA";
  expect(validateUnitManifest(badState).join(" ")).toContain("invalid state");
  expect(validateUnitManifest(null as never)).toEqual(["manifest must be a JSON object"]);
});

test("canonical identity, safe integers and empty selections are enforced", () => {
  const alias = doneManifest();
  alias.questionId = "문항 3";
  expect(validateUnitManifest(alias).join(" ")).toContain("canonical");
  expect(parseUnitSelection("all", ["Q3", "q03"]).questionIds).toEqual(["Q3"]);
  expect(() => parseUnitSelection(", ,")).toThrow("Empty unit selection");
  expect(() => createUnitManifest({ sourceSha256: SHA, questionId: "Q1", physicalPage: 9007199254740993 })).toThrow("safe integer");
  const unsafe = doneManifest();
  unsafe.source.physicalPage = 9007199254740993;
  expect(validateUnitManifest(unsafe).join(" ")).toContain("safe integer");
});

test("validation flags done-without-revision and missing stages", () => {
  const m = doneManifest();
  m.stages[0].outputRevision = null;
  expect(validateUnitManifest(m).join(" ")).toContain("outputRevision");
  const partial = createUnitManifest({ sourceSha256: SHA, questionId: "Q1", physicalPage: 1 });
  partial.stages = partial.stages.slice(0, 2);
  expect(validateUnitManifest(partial).join(" ")).toContain("Missing stage");
});
