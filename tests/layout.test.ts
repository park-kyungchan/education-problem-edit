import { expect, test } from "bun:test";
import { resolveLayout } from "../src/layout";

test("format alone does not choose a layout", () => {
  expect(resolveLayout({ format: "hwpx" }).state).toBe("selection-required");
});

test("explicit selection overrides a known layout without changing the format", () => {
  const result = resolveLayout({ requested: "reference-single-column", existing: "exam-two-column", format: "hwpx" });
  expect(result.state).toBe("selected");
  if (result.state !== "selected") throw new Error("Missing selection");
  expect(result.profile.columns).toBe(1);
  expect(result.format).toBe("hwpx");
  expect(result.reason).toBe("explicit-choice");
  expect(result.instanceCountsAreConstraints).toBe(false);
});

test("existing layout is preserved and invalid inputs are rejected", () => {
  expect(resolveLayout({ existing: "exam-two-column" }).state).toBe("selected");
  expect(() => resolveLayout({ requested: "reference-single-column", existing: "unknown" })).toThrow();
  expect(() => resolveLayout({ requested: "unknown" })).toThrow();
  expect(() => resolveLayout({ format: "pdf" })).toThrow();
});
