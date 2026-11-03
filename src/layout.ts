export type LayoutId = "exam-two-column" | "reference-single-column";
export type DocumentFormat = "hwp" | "hwpx";

export interface LayoutProfile {
  id: LayoutId;
  title: string;
  columns: number;
  readingOrder: string;
}

export const layouts: readonly LayoutProfile[] = [
  { id: "exam-two-column", title: "Original two-column exam sheet", columns: 2, readingOrder: "column-major" },
  { id: "reference-single-column", title: "Reference-style single-column flow", columns: 1, readingOrder: "top-to-bottom" },
];

export function resolveLayout(options: { requested?: string; existing?: string; format?: string }) {
  if (options.format !== undefined && options.format !== "hwp" && options.format !== "hwpx") {
    throw new Error("format must be hwp or hwpx");
  }
  const find = (id: string) => {
    const result = layouts.find((layout) => layout.id === id);
    if (!result) throw new Error(`Unknown layout profile: ${id}`);
    return result;
  };
  if (options.existing !== undefined) find(options.existing);
  const selected = options.requested ?? options.existing;
  if (selected === undefined) return { state: "selection-required" as const, choices: layouts, format: options.format ?? null };
  return {
    state: "selected" as const,
    profile: find(selected),
    reason: options.requested !== undefined ? "explicit-choice" : "preserve-existing-profile",
    format: options.format ?? null,
    instanceCountsAreConstraints: false,
  };
}
