/** Architecture type proposal only. Not a runtime/schema validator or upper Ontology change. */
type Id = string;
type Sha256 = string;
type XY = readonly [number,number];
type Region = { sourceSha256:Sha256; page:number; box:readonly [number,number,number,number]; coordinateSystem:'source-pixels'; scale:number };
type Evidence = { id:Id; region:Region; layer:'printed'|'student-writing'|'ambiguous'; observation:string };
type Claim<T> =
 | { kind:'visible'; value:T; evidence:Id[] }
 | { kind:'source-asserted'; value:T; evidence:Id[] }
 | { kind:'inferred'; value:T; basis:Id[]; rationale:string }
 | { kind:'authored-approximation'; value:T; authorizationRef:Id; rationale:string }
 | { kind:'unknown'; evidence:Id[]; reason:string; candidates?:T[] };
type Expr = {kind:'constant';value:number} | {kind:'parameter';id:Id} |
 {kind:'binary';op:'+'|'-'|'*'|'/';a:Expr;b:Expr};
type Parameter = { id:Id; unit:'unitless'|'degree'|'length'; claim:Claim<number>; editPolicy:'source-frozen'|'explicit-content-edit'|'layout-free'; bounds?:readonly [number,number] };
type Point = { id:Id; definition:Claim<
 {kind:'free';xy:XY} | {kind:'midpoint';a:Id;b:Id} |
 {kind:'intersection';objectA:Id;objectB:Id;branch:Id;extent:'segment'|'line'} |
 {kind:'perpendicular-foot';point:Id;line:Id} |
 {kind:'circumcenter'|'incenter';triangle:readonly [Id,Id,Id]}> };
type Entity = Point | { id:Id; kind:'segment'|'line'|'polygon'; points:Id[]; sourceClaim:Claim<string> };
type Constraint = { id:Id; claim:Claim<
 {kind:'incidence';point:Id;object:Id} |
 {kind:'parallel'|'perpendicular'|'equal-length';a:Id;b:Id} |
 {kind:'angle';rays:readonly [Id,Id];value:Expr} |
 {kind:'orientation';points:readonly [Id,Id,Id];sign:1|-1}>;
 enforcement:'required'|'advisory'|'disabled-pending-review'; tolerance:number };
type Label = { id:Id; anchor:Id; offset:XY; text:Claim<string>|{kind:'expression';expr:Expr;format:string}; styleRef:Id; avoid:Id[]; locked:boolean };
type LayoutObject = { id:Id; kind:'problem-text'|'math'|'options-box'|'proof-box'|'diagram-slot'; parent?:Id; contentRefs:Id[]; box:readonly [number,number,number,number] };
type DiagramIR = {
 schema:'math-document-editing.diagram-ir.proposal.v1'; upperOntologyPin:'0.2.0';
 id:Id; revision:Sha256; source:Region; evidence:Evidence[];
 parameters:Parameter[]; entities:Entity[]; constraints:Constraint[]; labels:Label[];
 style:Record<Id,{strokeWidth:number;dash?:number[];fontFamily?:string;fontSize?:number}>;
 view:{viewBox:readonly [number,number,number,number];pixelDimensions:readonly [number,number];scaleClaim:'schematic'|'metric'};
 layout:LayoutObject[]; originalComparisonRef:Id; unresolved:Id[];
 acceptanceDecision:null;
};
type BoundedPatch = {
 baseRevision:Sha256; requestedBy:Id; originalLanguage:string;
 class:'presentation'|'geometry-layout'|'content-parameter'|'evidence-correction';
 operations:({op:'label-offset';label:Id;offset:XY}|{op:'style';style:Id;strokeWidth:number}|
 {op:'free-point';point:Id;xy:XY}|{op:'parameter';parameter:Id;value:number})[];
 allowedTargets:Id[]; preserveConstraintIds:Id[]; maxOperations:number;
};
type RenderReceipt = { irSha256:Sha256; rendererIdentity:Id; fontHashes:Sha256[]; viewport:XY; svgSha256:Sha256; pngSha256?:Sha256; geometryResiduals:Record<Id,number>; changedIds:Id[]; originalComparisonRef:Id; evaluationRef:Id; acceptanceDecision:null };
export type { DiagramIR, BoundedPatch, RenderReceipt };
