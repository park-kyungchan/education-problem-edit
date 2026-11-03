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
  expect(() => parseQuestionId("Q0")).toThrow();
  expect(() => parseQuestionId("abc")).toThrow();
});

test("unit selection: single, subset, range and bounded all", () => {
  expect(parseUnitSelection("Q3")).toEqual({ kind: "single", questionIds: ["Q3"] });
  expect(parseUnitSelection("Q7,Q3").questionIds).toEqual(["Q3", "Q7"]);
  expect(parseUnitSelection("Q3-Q5").questionIds).toEqual(["Q3", "Q4", "Q5"]);
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

test("validation flags done-without-revision and missing stages", () => {
  const m = doneManifest();
  m.stages[0].outputRevision = null;
  expect(validateUnitManifest(m).join(" ")).toContain("outputRevision");
  const partial = createUnitManifest({ sourceSha256: SHA, questionId: "Q1", physicalPage: 1 });
  partial.stages = partial.stages.slice(0, 2);
  expect(validateUnitManifest(partial).join(" ")).toContain("Missing stage");
});
