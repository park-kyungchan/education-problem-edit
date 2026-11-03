import type { DecisionTaskUnit } from "../contracts.ts";

const COMMON_CANDIDATE_CHOICES = {
  A: "Candidate panel A",
  B: "Candidate panel B",
  C: "Candidate panel C",
  D: "Candidate panel D",
  none: "No candidate faithfully matches",
  unclear: "Insufficient readable image evidence to select a candidate",
} as const;

const COMMON_DEFECT_CHOICES = {
  missing_label: "A printed label is absent",
  wrong_line_style: "A printed solid/dashed line style differs",
  wrong_shape: "A printed geometric stroke/shape differs",
  none: "No listed discrepancy",
  unclear: "Insufficient readable image evidence",
} as const;

export const SYNTHETIC_CONTRACT_002_UNIT: DecisionTaskUnit = {
  schema: "math-editing.dual-route-decision-task.v1",
  unitId: "synthetic-contract-002",
  problemContentId: "synthetic-canary-002",
  problemNumber: null,
  stageRole: "comparable-decision",
  sourcePdfSha256: null,
  images: [
    {
      assetId: "fixture-002",
      role: "reference-montage",
      path: "model-probes/contract-002/fixture.png",
      sha256: "a174a6bb68d251cc0e5c853e1ca372056973e234eb73adbe8f6fa6072826ca59",
      mimeType: "image/png",
      widthPx: 1040,
      heightPx: 1040,
      byteLength: 32227,
      jevImageBoundsPassed: true,
      sendToVisionModel: true,
    },
  ],
  candidates: [
    { label: "A", description: "Candidate panel A in top-left quadrant" },
    { label: "B", description: "Candidate panel B in top-right quadrant" },
    { label: "C", description: "Candidate panel C in bottom-left quadrant" },
    { label: "D", description: "Candidate panel D in bottom-right quadrant" },
  ],
  designatedPanelForDefect: "B",
  taskInstructions: {
    bestCandidatePrompt:
      "Compare the reference panel with candidate panels A, B, C and D in the supplied image. Choose the candidate that faithfully matches the printed lines, labels and line styling; choose none if no candidate matches and unclear if the image is not readable enough to decide. Do not infer the answer from filenames or metadata.",
    defectPrompt:
      "Classify the most salient discrepancy in the candidate panel identified by the fixture layout, relative to the reference: missing_label, wrong_line_style, wrong_shape, none, or unclear.",
    candidateChoices: { ...COMMON_CANDIDATE_CHOICES },
    defectChoices: { ...COMMON_DEFECT_CHOICES },
  },
  referenceProvenance: {
    scopeKind: "preflighted-synthetic-canary",
    authorityInputId: "input-012",
    referencePaths: [
      {
        path: "model-probes/contract-002/preflight.json",
        sha256: "1f8d244ae2ab102987b79ff3591d4c65f76f9427d4c74d17f16d14d7b84c4e94",
      },
      {
        path: "model-probes/contract-002/hidden-truth.json",
        sha256: "b5b7a36c13a289038f336dcc3cd61a2e58025714539ca54cf25e1e9ba6eef975",
      },
    ],
    establishedScopeDescription:
      "Synthetic geometry montage with raster-verified separated dashes (9 black runs) and blinded ground truth outside model prompt.",
    unestablishedScopeDescription:
      "Single synthetic canary fixture; does not establish general Korean exam OCR accuracy or select a model winner.",
    accuracyEligible: true,
  },
  sourceUncertainties: [],
  hiddenGroundTruth: {
    best_candidate: "D",
    defect: "wrong_shape",
    blindedFromModelRequest: true,
  },
};

export const SYNTHETIC_CONTRACT_001_EXCLUDED_UNIT: DecisionTaskUnit = {
  schema: "math-editing.dual-route-decision-task.v1",
  unitId: "synthetic-contract-001-excluded",
  problemContentId: "synthetic-canary-001",
  problemNumber: null,
  stageRole: "comparable-decision",
  sourcePdfSha256: null,
  images: [
    {
      assetId: "fixture-001",
      role: "reference-montage",
      path: "model-probes/contract-001/fixture.png",
      sha256: "ecbdffc6986ac5923e39619ba0587013cdbcffb760cce0ed6a6384c44f059dda",
      mimeType: "image/png",
      widthPx: 1040,
      heightPx: 1040,
      byteLength: 31702,
      jevImageBoundsPassed: true,
      sendToVisionModel: true,
    },
  ],
  candidates: [
    { label: "A", description: "Candidate panel A" },
    { label: "B", description: "Candidate panel B" },
    { label: "C", description: "Candidate panel C" },
    { label: "D", description: "Candidate panel D" },
  ],
  designatedPanelForDefect: "A",
  taskInstructions: {
    bestCandidatePrompt:
      "Compare the reference panel with candidate panels A, B, C and D in the supplied image. Choose the candidate that faithfully matches the printed lines, labels and line styling; choose none if no candidate matches and unclear if the image is not readable enough to decide. Do not infer the answer from filenames or metadata.",
    defectPrompt:
      "Classify the most salient discrepancy in the candidate panel identified by the fixture layout, relative to the reference: missing_label, wrong_line_style, wrong_shape, none, or unclear.",
    candidateChoices: { ...COMMON_CANDIDATE_CHOICES },
    defectChoices: { ...COMMON_DEFECT_CHOICES },
  },
  referenceProvenance: {
    scopeKind: "excluded-invalid-synthetic-fixture",
    authorityInputId: "input-012",
    referencePaths: [
      {
        path: "model-probes/comparison.json",
        sha256: "b3b6bc1ea286bfbcd1dd8cd3bb7e74c26a16728740c3eb844ee216837c93ccf0",
      },
    ],
    establishedScopeDescription:
      "Transport and schema smoke observation only; historical Gateway charges (7,291 + 147 = 7,438 microUSD) remain counted in the session cap.",
    unestablishedScopeDescription:
      "Excluded from accuracy because PyMuPDF SVG rendering flattened the intended dashed base into a solid line.",
    accuracyEligible: false,
    exclusionReason:
      "SVG renderer flattened the intended dashed base into a solid line, making the unique-match label ambiguous.",
  },
  sourceUncertainties: [],
  hiddenGroundTruth: null,
};

export const PILOT_MC_01_UNIT: DecisionTaskUnit = {
  schema: "math-editing.dual-route-decision-task.v1",
  unitId: "pilot-mc-01",
  problemContentId: "mc-01",
  problemNumber: 1,
  stageRole: "comparable-decision",
  sourcePdfSha256: "82c365b790b30cec5c594d72f2b5b6fb6e6f98b504fd7182c28213e76969c9d4",
  images: [
    {
      assetId: "mc01-source-region",
      role: "source-region",
      path: "pilot/problem-01/source-region.png",
      sha256: "e2c1a5f02c51da60facc565dcad84b0f034ca2348707e64f3e1b8b20e88ecb35",
      mimeType: "image/png",
      widthPx: 870,
      heightPx: 520,
      byteLength: 233604,
      jevImageBoundsPassed: true,
      sendToVisionModel: true,
    },
    {
      assetId: "mc01-candidate-A",
      role: "candidate-panel",
      path: "pilot/problem-01/candidate-A.png",
      sha256: "55328b360c1cdc8e9cfe8217591c9fd6052f99856584c3ec3423604afd1c038b",
      mimeType: "image/png",
      widthPx: 720,
      heightPx: 450,
      byteLength: 13548,
      jevImageBoundsPassed: true,
      sendToVisionModel: true,
    },
    {
      assetId: "mc01-candidate-B",
      role: "candidate-panel",
      path: "pilot/problem-01/candidate-B.png",
      sha256: "f08292c3b34b0289fa75caa430f5fa3d17bb88d186a3cb3fbfe52e152f5363a3",
      mimeType: "image/png",
      widthPx: 720,
      heightPx: 450,
      byteLength: 15704,
      jevImageBoundsPassed: true,
      sendToVisionModel: true,
    },
  ],
  candidates: [
    {
      label: "A",
      description: "Pilot problem 1 layout candidate A (pilot/problem-01/candidate-A.png)",
      sourceArtifactPath: "pilot/problem-01/candidate-A.svg",
    },
    {
      label: "B",
      description:
        "Pilot problem 1 cleaner-layout candidate B selected by user for visual style direction (pilot/problem-01/candidate-B.png)",
      sourceArtifactPath: "pilot/problem-01/candidate-B.svg",
    },
  ],
  designatedPanelForDefect: "B",
  taskInstructions: {
    bestCandidatePrompt:
      "Compare the first image (original scan region of problem 1 with student pencil marks) against the second image (Candidate A) and third image (Candidate B). Choose the candidate that faithfully preserves the printed triangle ABC geometry, vertex labels (A, B, C), side labels (6 cm, x cm), and angle labels (y°, 53°, 53°) while excluding handwritten pencil calculations. Choose none if neither matches and unclear if the source scan is unreadable.",
    defectPrompt:
      "Classify any discrepancy in Candidate B relative to the printed figure in the original scan region (excluding student handwriting): missing_label, wrong_line_style, wrong_shape, student_mark_contamination, none, or unclear.",
    candidateChoices: { ...COMMON_CANDIDATE_CHOICES },
    defectChoices: {
      ...COMMON_DEFECT_CHOICES,
      student_mark_contamination: "Student handwriting or grading mark erroneously included as printed content",
    },
  },
  referenceProvenance: {
    scopeKind: "user-accepted-pilot-gate-1",
    authorityInputId: "input-028",
    referencePaths: [
      {
        path: "pilot/problem-01/code-bundle.json",
        sha256: "a6d3bf79211ead91b3211d4158c5c923dd8d08876f60e738d8f924ccb6f3ab5e",
      },
      {
        path: "pilot/problem-01/user-review.json",
        sha256: "31e65a0f87849786f553ad1d23f5cac93ce9fbeccd136a0a0a1ff11f5dc091b8",
      },
    ],
    establishedScopeDescription:
      "User selected cleaner-layout B (input-016) and reported positive visual review on problem-01 DOCX (input-028); user-reviewed TXT stem matches normalized LaTeX.",
    unestablishedScopeDescription:
      "Original source fidelity of every stroke was not separately adjudicated by the user; pilot gate review does not eliminate per-problem HITL on later problems.",
    accuracyEligible: true,
  },
  sourceUncertainties: [],
  hiddenGroundTruth: {
    best_candidate: "B",
    defect: "none",
    blindedFromModelRequest: true,
  },
};

export const PILOT_MC_02_UNIT: DecisionTaskUnit = {
  schema: "math-editing.dual-route-decision-task.v1",
  unitId: "pilot-mc-02",
  problemContentId: "mc-02",
  problemNumber: 2,
  stageRole: "comparable-decision",
  sourcePdfSha256: "82c365b790b30cec5c594d72f2b5b6fb6e6f98b504fd7182c28213e76969c9d4",
  images: [
    {
      assetId: "mc02-source-region",
      role: "source-region",
      path: "pilot/problem-02/code-artifact/assets/source-region.png",
      sha256: "cc4c65ed0f4cde8851cffded84beceaba5b7e5f68618351d59c99db875f5c65b",
      mimeType: "image/png",
      widthPx: 890,
      heightPx: 610,
      byteLength: 282900,
      jevImageBoundsPassed: true,
      sendToVisionModel: true,
    },
    {
      assetId: "mc02-candidate-A",
      role: "candidate-panel",
      path: "pilot/problem-02/code-artifact/figure.png",
      sha256: "a5f8e98d15cb13f901eb9947bb454719cf9396592a702ec8c43e6f52693a228e",
      mimeType: "image/png",
      widthPx: 1280,
      heightPx: 820,
      byteLength: 29862,
      jevImageBoundsPassed: true,
      sendToVisionModel: true,
    },
    {
      assetId: "mc02-corner-B-detail",
      role: "detail-crop-evidence-only",
      path: "pilot/problem-02/code-artifact/assets/corner-B.png",
      sha256: "7c04866a99fb68baedbf781d98953e4379f1c5a3287a3d6cc719e618649b3ce0",
      mimeType: "image/png",
      widthPx: 100,
      heightPx: 125,
      byteLength: 8466,
      jevImageBoundsPassed: false,
      sendToVisionModel: false,
    },
    {
      assetId: "mc02-corner-C-detail",
      role: "detail-crop-evidence-only",
      path: "pilot/problem-02/code-artifact/assets/corner-C.png",
      sha256: "03586fc4d354d8451fc04d54a3fbbeaf2b888a0ba1460f2de9cd07e22b0d6819",
      mimeType: "image/png",
      widthPx: 115,
      heightPx: 130,
      byteLength: 8706,
      jevImageBoundsPassed: false,
      sendToVisionModel: false,
    },
  ],
  candidates: [
    {
      label: "A",
      description:
        "Pilot problem 2 portable clean figure (pilot/problem-02/code-artifact/figure.png) excluding ambiguous B/C corner arcs",
      sourceArtifactPath: "pilot/problem-02/code-artifact/figure.svg",
      sourceArtifactSha256: "d435918d27ddf4ce1384157ca0ac80d6892782f9a74c50bbdfd507ea847f4f1c",
    },
  ],
  designatedPanelForDefect: "A",
  taskInstructions: {
    bestCandidatePrompt:
      "Compare the first image (original scan region of problem 2 rectangle ABCD with diagonals intersecting at O) against the second image (Candidate A clean reconstruction). Choose A if Candidate A faithfully represents the clearly printed rectangle ABCD, intersection O, and angle labels x°, y°, 110°; choose none if it contradicts clearly printed geometry; choose unclear if small arc-like strokes near B and C cannot be separated from student handwriting from the scan alone.",
    defectPrompt:
      "Classify the status of Candidate A relative to the original scan region: missing_label, wrong_line_style, wrong_shape, student_mark_contamination, none, or unclear.",
    candidateChoices: { ...COMMON_CANDIDATE_CHOICES },
    defectChoices: {
      ...COMMON_DEFECT_CHOICES,
      student_mark_contamination: "Student handwriting or grading mark erroneously included as printed content",
    },
  },
  referenceProvenance: {
    scopeKind: "user-accepted-pilot-gate-2",
    authorityInputId: "input-030",
    referencePaths: [
      {
        path: "pilot/problem-02/code-bundle.json",
        sha256: "75a5c39eafed6b1afffedff599c3a8dfd90938ea7aabee58983fd14fd4257fc6",
      },
      {
        path: "pilot/problem-02/user-review.json",
        sha256: "c04d2e63e3e1dedae8d5a15991756acdc188e6f983d1d44ad5322c211ec64e3a",
      },
      {
        path: "restoration-cases.json",
        sha256: "91fa1a794e4ce61f91ddcda7c4358cc46d3acc0898b16999bda54f82b8f26be0",
      },
    ],
    establishedScopeDescription:
      "User passed Gate 2 for the portable bundle (input-030) while individual stroke provenance near corners B and C remains unadjudicated.",
    unestablishedScopeDescription:
      "Small arc-like strokes near vertices B and C overlap student angle calculations; neither model agreement nor mathematical solving establishes whether those strokes were printed.",
    accuracyEligible: true,
  },
  sourceUncertainties: [
    {
      id: "CASE-OVERLAP-MC02:corner-arc-provenance",
      problemContentId: "mc-02",
      status: "ambiguous",
      description:
        "Small arc-like strokes near B and C overlap student angle calculations. Printed-versus-student provenance is not conclusively established from this scan.",
      markOverlap: "crosses-content",
      detailImagePins: [
        {
          path: "pilot/problem-02/code-artifact/assets/corner-B.png",
          sha256: "7c04866a99fb68baedbf781d98953e4379f1c5a3287a3d6cc719e618649b3ce0",
        },
        {
          path: "pilot/problem-02/code-artifact/assets/corner-C.png",
          sha256: "03586fc4d354d8451fc04d54a3fbbeaf2b888a0ba1460f2de9cd07e22b0d6819",
        },
      ],
      modelAgreementCanResolve: false,
      mathSolvingCanResolve: false,
    },
  ],
  hiddenGroundTruth: null,
};

export const PILOT_MC_03_HELD_UNIT: DecisionTaskUnit = {
  schema: "math-editing.dual-route-decision-task.v1",
  unitId: "pilot-mc-03-held",
  problemContentId: "mc-03",
  problemNumber: 3,
  stageRole: "comparable-decision",
  sourcePdfSha256: "82c365b790b30cec5c594d72f2b5b6fb6e6f98b504fd7182c28213e76969c9d4",
  images: [],
  candidates: [],
  designatedPanelForDefect: null,
  taskInstructions: {
    bestCandidatePrompt: "Held problem 3; must not execute.",
    defectPrompt: "Held problem 3; must not execute.",
    candidateChoices: { ...COMMON_CANDIDATE_CHOICES },
    defectChoices: { ...COMMON_DEFECT_CHOICES },
  },
  referenceProvenance: {
    scopeKind: "held-pilot-gate-3",
    authorityInputId: "input-030",
    referencePaths: [
      {
        path: "pilot/workflow.json",
        sha256: "dcd489ae9361f57c3735df059f66e9d7d200cb2229a7d5b9757e73e21cec46e3",
      },
    ],
    establishedScopeDescription: "Problem 3 pilot reconstruction is explicitly held by user input-030.",
    unestablishedScopeDescription: "No problem 3 clean candidate or evaluation may run until new user direction.",
    accuracyEligible: false,
    exclusionReason: "Explicitly held by input-030",
  },
  sourceUncertainties: [],
  hiddenGroundTruth: null,
};

export const ALL_EVALUATION_UNITS: Record<string, DecisionTaskUnit> = {
  "synthetic-contract-002": SYNTHETIC_CONTRACT_002_UNIT,
  "synthetic-contract-001-excluded": SYNTHETIC_CONTRACT_001_EXCLUDED_UNIT,
  "pilot-mc-01": PILOT_MC_01_UNIT,
  "pilot-mc-02": PILOT_MC_02_UNIT,
  "pilot-mc-03-held": PILOT_MC_03_HELD_UNIT,
};
