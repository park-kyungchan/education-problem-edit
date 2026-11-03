import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type CandidateChoiceLabel,
  type DecisionTaskUnit,
  type DefectChoiceLabel,
  type FinalGateDisposition,
  JEV_NATIVE_IMAGE_LIMITS,
  type OptionalGenerativeStageSpec,
  type PinnedImageAsset,
} from "../contracts.ts";

export interface ParsedImageDimensions {
  mimeType: "image/png" | "image/jpeg";
  widthPx: number;
  heightPx: number;
  byteLength: number;
}

/**
 * Pure deterministic PNG / JPEG header parser.
 * Reads image dimensions and MIME format directly from byte headers.
 */
export function parseImageHeaderDimensions(bytes: Uint8Array): ParsedImageDimensions {
  const byteLength = bytes.byteLength;
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    byteLength >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const widthPx = view.getUint32(16, false);
    const heightPx = view.getUint32(20, false);
    return { mimeType: "image/png", widthPx, heightPx, byteLength };
  }

  // JPEG signature: FF D8
  if (byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (offset + 8 < byteLength) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1]!;
      if (marker === 0xff) {
        offset++;
        continue;
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = view.getUint16(offset + 2, false);
      if (length < 2 || offset + 2 + length > byteLength) break;
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        const heightPx = view.getUint16(offset + 5, false);
        const widthPx = view.getUint16(offset + 7, false);
        return { mimeType: "image/jpeg", widthPx, heightPx, byteLength };
      }
      offset += 2 + length;
    }
  }

  throw new Error("UNSUPPORTED_OR_CORRUPT_IMAGE_HEADER");
}

export function checkJevNativeImageBounds(meta: ParsedImageDimensions): {
  passed: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const pixels = meta.widthPx * meta.heightPx;
  if (meta.byteLength > JEV_NATIVE_IMAGE_LIMITS.maxDecodedFileBytes) {
    reasons.push(
      `byteLength ${meta.byteLength} > ${JEV_NATIVE_IMAGE_LIMITS.maxDecodedFileBytes}`,
    );
  }
  if (meta.widthPx < JEV_NATIVE_IMAGE_LIMITS.minWidthPx) {
    reasons.push(`widthPx ${meta.widthPx} < ${JEV_NATIVE_IMAGE_LIMITS.minWidthPx}`);
  }
  if (meta.heightPx < JEV_NATIVE_IMAGE_LIMITS.minHeightPx) {
    reasons.push(`heightPx ${meta.heightPx} < ${JEV_NATIVE_IMAGE_LIMITS.minHeightPx}`);
  }
  if (meta.widthPx > JEV_NATIVE_IMAGE_LIMITS.maxWidthPx) {
    reasons.push(`widthPx ${meta.widthPx} > ${JEV_NATIVE_IMAGE_LIMITS.maxWidthPx}`);
  }
  if (meta.heightPx > JEV_NATIVE_IMAGE_LIMITS.maxHeightPx) {
    reasons.push(`heightPx ${meta.heightPx} > ${JEV_NATIVE_IMAGE_LIMITS.maxHeightPx}`);
  }
  if (pixels < JEV_NATIVE_IMAGE_LIMITS.minPixels) {
    reasons.push(`pixels ${pixels} < ${JEV_NATIVE_IMAGE_LIMITS.minPixels}`);
  }
  if (pixels > JEV_NATIVE_IMAGE_LIMITS.maxPixels) {
    reasons.push(`pixels ${pixels} > ${JEV_NATIVE_IMAGE_LIMITS.maxPixels}`);
  }
  return {
    passed: reasons.length === 0,
    reasons,
  };
}

export function getOptionalGenerativeStageSpec(): OptionalGenerativeStageSpec {
  return {
    schema: "math-editing.optional-generative-stage.v1",
    stageRole: "optional-generative-authoring",
    supportedRoutes: ["gpt-gemini-baseline"],
    jevSupported: false,
    nonEquivalenceReason:
      "System One Jev-1.14 is a structured Decision model returning discrete choice/score/noul distributions; freeform OCR transcription and SVG/TikZ code generation are distinct baseline-only authoring stages and must not be scored as a common benchmark.",
    outputKind: "normalized-latex-and-visual-scene-draft",
  };
}

export async function verifyAndLoadTaskUnitImages(
  unit: DecisionTaskUnit,
  workspaceRoot: string,
): Promise<Map<string, { asset: PinnedImageAsset; bytes: Buffer; base64: string }>> {
  if (
    unit.problemNumber === 3 ||
    unit.problemContentId === "mc-03" ||
    unit.referenceProvenance.scopeKind === "held-pilot-gate-3"
  ) {
    throw new Error(
      "HOLD_PROBLEM_03:Problem 3 pilot reconstruction and evaluation are explicitly held by user decision input-030.",
    );
  }

  if (unit.stageRole !== "comparable-decision") {
    throw new Error(`INVALID_STAGE_ROLE_FOR_COMPARABLE_DECISION:${String(unit.stageRole)}`);
  }

  const loaded = new Map<string, { asset: PinnedImageAsset; bytes: Buffer; base64: string }>();
  let visionImageCount = 0;

  for (const asset of unit.images) {
    const absPath = resolve(workspaceRoot, asset.path);
    const bytes = await readFile(absPath);
    const actualSha = createHash("sha256").update(bytes).digest("hex");
    if (actualSha !== asset.sha256) {
      throw new Error(`IMAGE_ASSET_HASH_DRIFT:${asset.path}:${actualSha}!=${asset.sha256}`);
    }
    const parsed = parseImageHeaderDimensions(bytes);
    if (
      parsed.widthPx !== asset.widthPx ||
      parsed.heightPx !== asset.heightPx ||
      parsed.mimeType !== asset.mimeType ||
      parsed.byteLength !== asset.byteLength
    ) {
      throw new Error(`IMAGE_ASSET_METADATA_MISMATCH:${asset.path}`);
    }
    const bounds = checkJevNativeImageBounds(parsed);
    if (bounds.passed !== asset.jevImageBoundsPassed) {
      throw new Error(`IMAGE_BOUNDS_FLAG_MISMATCH:${asset.path}`);
    }
    if (asset.sendToVisionModel) {
      if (!bounds.passed) {
        throw new Error(
          `IMAGE_OUTSIDE_JEV_NATIVE_BOUNDS:${asset.path}:${bounds.reasons.join("; ")}`,
        );
      }
      visionImageCount++;
    }
    loaded.set(asset.assetId, {
      asset,
      bytes,
      base64: bytes.toString("base64"),
    });
  }

  if (visionImageCount === 0) {
    throw new Error(`NO_VISION_ELIGIBLE_IMAGES_IN_TASK_UNIT:${unit.unitId}`);
  }

  for (const ref of unit.referenceProvenance.referencePaths) {
    const refBytes = await readFile(resolve(workspaceRoot, ref.path));
    const refSha = createHash("sha256").update(refBytes).digest("hex");
    if (refSha !== ref.sha256) {
      throw new Error(`REFERENCE_PROVENANCE_HASH_DRIFT:${ref.path}:${refSha}!=${ref.sha256}`);
    }
  }

  for (const unc of unit.sourceUncertainties) {
    if (unc.modelAgreementCanResolve !== false || unc.mathSolvingCanResolve !== false) {
      throw new Error(`INVALID_UNCERTAINTY_RESOLUTION_RULE:${unc.id}`);
    }
    for (const detailPin of unc.detailImagePins) {
      const detailBytes = await readFile(resolve(workspaceRoot, detailPin.path));
      const detailSha = createHash("sha256").update(detailBytes).digest("hex");
      if (detailSha !== detailPin.sha256) {
        throw new Error(`DETAIL_CROP_HASH_DRIFT:${detailPin.path}`);
      }
    }
  }

  return loaded;
}

export function hasUnresolvedSourceUncertainty(unit: DecisionTaskUnit): {
  hasUnresolved: boolean;
  uncertaintyIds: string[];
} {
  const unresolved = unit.sourceUncertainties.filter(
    (u) =>
      u.status === "ambiguous" ||
      u.status === "unrecoverable-from-selected-source" ||
      u.status === "not-yet-transcribed",
  );
  return {
    hasUnresolved: unresolved.length > 0,
    uncertaintyIds: unresolved.map((u) => u.id),
  };
}

/**
 * Computes final HITL gate disposition.
 * Unknown/ambiguous source ALWAYS remains unknown ("escalate-hitl-unknown-source")
 * even when a model (or both models in agreement) returns a confident choice.
 */
export function evaluateHitlGateDisposition(params: {
  unit: DecisionTaskUnit;
  answers: {
    best_candidate: CandidateChoiceLabel;
    defect: DefectChoiceLabel;
  };
}): FinalGateDisposition {
  const { unit, answers } = params;
  if (!unit.referenceProvenance.accuracyEligible) {
    return "excluded-invalid-fixture";
  }

  const { hasUnresolved } = hasUnresolvedSourceUncertainty(unit);
  if (hasUnresolved) {
    return "escalate-hitl-unknown-source";
  }

  if (
    answers.best_candidate === "unclear" ||
    answers.best_candidate === "none" ||
    answers.defect === "unclear"
  ) {
    return "escalate-hitl-model-unclear-or-none";
  }

  if (unit.designatedPanelForDefect === null && answers.defect !== "none") {
    return "reject-candidate-defect-detected";
  }

  return "candidate-admitted-for-human-gate-review";
}
