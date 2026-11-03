/** Domain-local knowledge contracts. Upper Ontology 0.2.0 is unchanged. */
export type StageId =
  | 'routing' | 'source' | 'regions' | 'transcription' | 'semantics'
  | 'geometry' | 'assets' | 'equations' | 'question-layout' | 'page-layout'
  | 'package' | 'native' | 'delivery' | 'feedback';
export type EvidenceClass = 'observed-code' | 'historical-receipt' | 'user-requirement' | 'proposal' | 'derived-guidance';
export type Applicability = 'historical-instance' | 'conditional-reuse' | 'proposed-contract';
export interface Citation { sourceId: string; pointer?: string; contains?: string }
export type RetrievalCandidate =
  | { kind: 'source-occurrence'; id: string; sourceId: string; sourceSha256: string;
      selector: {kind:'lines'; first:number; last:number}; exactText: string; facetIds:string[] }
  | { kind: 'metadata-description'; id: string; description: string; facetIds:string[] };
export interface SourceSpec {
  id: string; path: string; role: 'implementation' | 'receipt' | 'requirement' | 'proposal' | 'research';
  mutable: boolean; note: string;
}
export interface SourceCapture extends SourceSpec {
  sha256: string; bytes: number; capturedAt: string; snapshot: string;
}
export interface BaseRecord {
  id: string; title: string; stage: StageId; evidenceClass: EvidenceClass;
  applicability: Applicability; evidence: Citation[]; limitation: string;
}
export interface Rule extends BaseRecord {
  kind: 'rule'; when: string; do: string[]; avoid: string[];
  check: string[]; invalidates: StageId[];
}
export interface Procedure extends BaseRecord {
  kind: 'procedure'; inputs: string[]; steps: string[]; outputs: string[];
  stopWhen: string[]; ruleIds: string[]; implementationSourceIds: string[];
  behaviors?: {
    feature:string; state:'observed'|'documented'|'not-exercised'|'unsupported-in-cited-source';
    sourceIds:string[]; facts:Record<string,string|number|boolean|string[]>;
  }[];
}
export interface Case extends BaseRecord {
  kind: 'case'; exam: 'jungdong-20261020' | 'jungdong-20261021' | 'daechi-20261022';
  question: number | null; symptom: string; cause: string | null;
  expected: string; outcome: 'reported-corrected' | 'requirement-recorded' | 'candidate-implemented' | 'unresolved';
  ruleIds: string[]; requiredChecks: string[];
  metric: { usd: number | null; seconds: number | null; measuredSavings: null };
}
export type KnowledgeRecord = Rule | Procedure | Case;
export interface Stage {
  id: StageId; layer: 'evidence' | 'meaning' | 'construction' | 'document' | 'evaluation';
  input: string[]; output: string[]; invariant: string; defaultExecutor: string;
}
export interface Flow { from: StageId; to: StageId; relation: 'feeds'; reason: string }
export interface Route {
  id: string; keywords: string[]; title: string; stages: StageId[];
  procedureIds: string[]; ruleIds: string[]; caseIds: string[];
  outputContract: string; escalation: string;
}
export interface KnowledgeGraph {
  nodes: { id: string; kind: 'domain' | 'layer' | 'stage' | 'record' | 'source' }[];
  edges: { from: string; to: string; relation: 'contains' | 'feeds' | 'supported-by' | 'uses-rule' | 'implements' }[];
}
export interface InventoryRow {
  rootId: string; path: string; group: string; extension: string; bytes: number;
  modifiedAt: string; role: 'code' | 'structured-record' | 'document' | 'asset' | 'other';
  semanticReview: 'inventory-only';
}
export interface ReleaseManifest {
  schema: 'math-editing.knowledge-release.v1'; release: string; capturedAt: string;
  upperOntologyPin: '0.2.0'; sourceCount: number; recordCount: number; inventoryCount: number;
  sourceAccuracyAcceptance: null; canonicalWorkRegistrationPerformed: false;
  costs: { newPaidCalls: 0; savingsMeasured: false; scope?: 'release-construction-only' };
  coverage: string; limitations: string[];
}

// Interchange contracts for future producers. These are specifications, not an installed pipeline.
export type Claim<T> =
  | { kind: 'printed-observation'; value: T; evidence: RegionRef[] }
  | { kind: 'source-assertion'; value: T; evidence: RegionRef[] }
  | { kind: 'inference'; value: T; basedOn: string[]; rationale: string }
  | { kind: 'authorized-approximation'; value: T; authorizationRef: string; unresolved: string[] }
  | { kind: 'unknown'; evidence: RegionRef[]; alternatives: T[]; reason: string };
export interface RegionRef {
  sourceSha256: string; physicalPage: number; logicalPage: number;
  box: { space: 'source-pixels'; xyxy: [number, number, number, number]; imageSize: [number, number] }
    | { space: 'normalized'; xyxy: [number, number, number, number]; transformRef: string };
}
export interface SourceMark {
  id: string; region: RegionRef;
  primitive: 'segment' | 'dot' | 'arc' | 'right-angle-corner' | 'leader-arrow' | 'parallel-arrow' | 'length-tick' | 'angle-tick' | 'fill' | 'dash' | 'label' | 'underline';
  provenance: Claim<'printed' | 'student' | 'ambiguous'>;
  semanticRoleRef: string | null; action: 'retain' | 'exclude-from-restoration' | 'unresolved';
}
export interface Dependency {
  from: string; to: string; aspect: 'content' | 'topology' | 'geometry' | 'style' | 'metrics' | 'layout';
  inputRevision: string; outputRevision: string;
}
export interface GeometryNode {
  id: string;
  construction: Claim<
    | { kind: 'free-point'; xy: [number, number] }
    | { kind: 'midpoint'; endpoints: [string, string] }
    | { kind: 'intersection'; objects: [string, string]; extent: 'line' | 'segment' | 'ray'; branch: string }
    | { kind: 'perpendicular-foot'; point: string; line: string }
    | { kind: 'circumcenter' | 'incenter'; vertices: [string, string, string] }>;
}
export type ContentRun =
  | { id: string; kind: 'text'; text: Claim<string>; underline: boolean; bold: boolean }
  | { id: string; kind: 'math'; semanticRef: string; eqScript: string; metricKey: string }
  | { id: string; kind: 'blank'; blankId: string };
export interface EquationMetricKey {
  normalizedScript: string; normalizerRevision: string; baseUnitHwp: number;
  fontName: string; fontSha256: string | null; nativeVersion: string;
  equationVersion: string; measurementMethod: 'native-equation-create' | 'qualified-pdf-ink';
}
export interface QuestionLayout {
  questionId: string; contentRevision: string;
  container: { kind: 'borderless-native-table'; rows: 1; columns: 1; contentRefs: string[] };
  localBlocks: { id: string; kind: 'stem' | 'diagram' | 'choices' | 'proof' | 'example'; contentRefs: string[] }[];
}
export interface PageTemplate {
  id: string; paper: 'A4'; columns: number; questionsPerPage: number;
  order: 'column-major' | 'row-major'; headerProfile: string; bodyHeightMm: number;
  slots: { id: string; column: number; rank: number; minimumHeightMm: number; overflowPolicy: 'reflow-with-review' | 'fail' }[];
}
export type LayoutProfileId = 'exam-two-column' | 'reference-single-column';
export type NativeDocumentFormat = 'hwp' | 'hwpx';
export interface LayoutProfile {
  id: LayoutProfileId; title: string; columns: 1 | 2;
  formatIndependent: true;
  sharedContent: readonly string[];
  composition: string[];
  evidence: Citation[];
  observedInstance: {
    exam: 'daechi-20261022'; pages: number; questionsPerPage: number; questions: 24;
    artifactPath: string; artifactSha256: string; nativeFormat: NativeDocumentFormat;
    instanceOnly: true; templateParameters: Record<string, number | string>;
  };
  limitation: string;
}
export type LayoutSelection =
  | { state: 'selected'; profile: LayoutProfile; reason: 'explicit-choice' | 'preserve-existing-profile'; format: NativeDocumentFormat | null; instanceCountsAreConstraints: false }
  | { state: 'selection-required'; choices: { id: LayoutProfileId; title: string; columns: number }[]; format: NativeDocumentFormat | null; next: string };
export interface ImageBinding {
  questionId:string; tableId:string; pictureControlId:string; binaryItemId:string;
  member:string; expectedPayloadSha256:string; pixelSize:[number,number];
  embedding:{widthHwp:number;heightHwp:number;cropRef:string|null;transformRef:string};
  resourceReferences:{questionId:string;pictureControlId:string}[];
}
/** Producer interchange specification; existing scene renderers are not rewritten by this type. */
export type FigurePresentationFeature =
  | {kind:'angle-marker'; id:string; vertexRef:string; rayRefs:[string,string];
      encoding:'dots'|'arc'|'right-angle-corner'|'equality-ticks'; sourceRoleRef:string; relationRef:string|null}
  | {kind:'label-placement'; id:string; labelRef:string; ownerRef:string;
      box:{space:'figure-pixels';xyxy:[number,number,number,number]}; preservedGeometryRevision:string}
  | {kind:'sector-fill'; id:string; vertexRef:string; rayRefs:[string,string];
      fillOpacity:number; strokeOpacity:number; layer:'beneath-geometry'; preservedGeometryRevision:string};
export interface SelectedImagePatch {
  schema:'math-editing.selected-image-patch.v1'; basePackageSha256:string; outputPath:string;
  replacements:{binding:ImageBinding;replacementPath:string;replacementSha256:string}[];
  envelope:{preservePixelSize:true;preserveEmbedding:true;preserveOwnership:true;rejectSharedMedia:true};
  verification:{allowedChangedMembers:string[];nonTargetMembersByteIdentical:boolean;
    currentVisualEvidenceRef:string;embeddedPreview:'retained-stale'|'separately-refreshed';
    sourceAccuracyAcceptance:null};
}
export interface FeedbackEvent {
  schema: 'math-editing.feedback-event.v1'; id: string;
  origin: 'actual-user' | 'independent-evaluator' | 'producer';
  target: { artifactSha256: string; questionId: string; nodeId: string; region: RegionRef | null };
  defect: 'omission' | 'extra-mark' | 'wrong-provenance' | 'wrong-topology' | 'glyph' | 'spacing' | 'alignment' | 'containment';
  observation: string; expected: Claim<string>; rubricCriterionRef: string | null;
  attribution: { status: 'suspected' | 'supported' | 'unknown'; stage: StageId; evidenceRefs: string[] };
  dependencies: Dependency[];
  attempts: { id: string; inputHashes: string[]; outputHashes: string[]; promptRef: string | null;
    requestedModel: string | null; observedModel: string | null;
    seconds: number | null; providerUsd: number | null; unknownLiabilityUsd: number | null;
    verificationRefs: string[]; evaluationRefs: string[]; supersedesAttempt: string | null }[];
  acceptanceDecisionRef: string | null;
}
