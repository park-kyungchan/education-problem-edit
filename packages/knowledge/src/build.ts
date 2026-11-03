import { mkdir, readdir, lstat, readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, relative } from 'node:path';
import { sourceSpecs, stages, flows, records, routes, inventoryRoots, inventoryExclusions } from './catalog';
import { json, sha256, makeGraph, validateDataset, validateSnapshots, citationLocator } from './lib';
import type { SourceCapture, InventoryRow, ReleaseManifest } from './contracts';
import { layoutProfiles, validateLayoutProfiles } from './layouts';
const root=resolve(import.meta.dir,'..');
const release=process.argv[2]??'2026-10-22.1';
if(!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(release))throw new Error('Release must be YYYY-MM-DD.N');
const destination=resolve(root,'releases',release);
if(existsSync(destination))throw new Error(`Immutable release already exists: ${release}. Use a new release number.`);
const temporary=resolve(root,'releases',`.building-${release}-${process.pid}`);
await mkdir(resolve(temporary,'snapshots'),{recursive:true});
await mkdir(resolve(temporary,'records'),{recursive:true});
const capturedAt=new Date().toISOString();
const captures:SourceCapture[]=[],sourceText=new Map<string,string>();
for(const spec of sourceSpecs){
  const data=await readFile(spec.path),digest=sha256(data),snapshot=`snapshots/${digest}${extname(spec.path)}`;
  if(!existsSync(resolve(temporary,snapshot)))await writeFile(resolve(temporary,snapshot),data,{flag:'wx'});
  captures.push({...spec,sha256:digest,bytes:data.length,capturedAt,snapshot});
  sourceText.set(spec.id,data.toString('utf8'));
}
const graph=makeGraph(stages,flows,records,captures);
validateLayoutProfiles(layoutProfiles,captures.map(s=>s.id));
const counts=validateDataset(stages,flows,records,captures,routes,graph);
const citations=records.flatMap(r=>r.evidence.map(e=>({recordId:r.id,...citationLocator(e,sourceText.get(e.sourceId)!)})));
const inventory:InventoryRow[]=[],excluded:Record<string,number>={},errors:{path:string;message:string}[]=[];
async function walk(rootId:string,base:string,directory:string){
  let entries;
  try{entries=await readdir(directory,{withFileTypes:true});}catch(e){errors.push({path:directory,message:String(e)});return;}
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
    const path=resolve(directory,entry.name);
    if(entry.isDirectory()){
      if(inventoryExclusions.includes(entry.name)){excluded[entry.name]=(excluded[entry.name]??0)+1;continue;}
      await walk(rootId,base,path);continue;
    }
    if(entry.isSymbolicLink()){excluded['symlink']=(excluded['symlink']??0)+1;continue;}
    if(!entry.isFile())continue;
    try{
      const stat=await lstat(path),extension=extname(path).toLowerCase(),rel=relative(base,path);
      const role:InventoryRow['role']=['.ts','.js','.py','.ps1','.sh'].includes(extension)?'code':['.json','.jsonl'].includes(extension)?'structured-record':['.md','.txt','.html'].includes(extension)?'document':['.png','.jpg','.jpeg','.pdf','.svg','.hwpx','.hwp','.docx'].includes(extension)?'asset':'other';
      inventory.push({rootId,path,group:rel.split('/')[0],extension,bytes:stat.size,modifiedAt:stat.mtime.toISOString(),role,semanticReview:'inventory-only'});
    }catch(e){errors.push({path,message:String(e)});}
  }
}
for(const item of inventoryRoots)await walk(item.id,item.path,item.path);
const byRoot=Object.fromEntries(inventoryRoots.map(r=>[r.id,{path:r.path,count:inventory.filter(x=>x.rootId===r.id).length,groups:Object.fromEntries([...new Set(inventory.filter(x=>x.rootId===r.id).map(x=>x.group))].map(g=>[g,inventory.filter(x=>x.rootId===r.id&&x.group===g).length]))}]));
const manifest:ReleaseManifest={schema:'math-editing.knowledge-release.v1',release,capturedAt,upperOntologyPin:'0.2.0',sourceCount:captures.length,recordCount:records.length,inventoryCount:inventory.length,
  sourceAccuracyAcceptance:null,canonicalWorkRegistrationPerformed:false,costs:{newPaidCalls:0,savingsMeasured:false,scope:'release-construction-only'},
  coverage:'File-level inventory across selected operation roots; curated semantic synthesis of pinned sources. Inventory-only entries are not claimed to be semantically reviewed.',
  limitations:['External active sources are frozen snapshots; later changes require curated successor ingestion.','Historical verification is scoped to exact recorded bytes and fixtures.','No full automatic printed/handwritten classifier, generalized geometry solver or canonical rubric is installed by this release.','Native retrieval trials measure actual time/tokens; causal knowledge-space savings remain unmeasured. Packet size is a retrieval bound.']};
const index=records.map(r=>({id:r.id,kind:r.kind,title:r.title,stage:r.stage,path:`records/${r.id}.json`}));
const integrations={schema:'math-editing.integration-map.v1',upperOntologyPin:'0.2.0',status:'local-artifact-only',
  concurrentRubricOwner:{root:opsRoot('math-pipeline-audit-20261022'),sourceIds:['S-rubric22','S-eval22','S-verifypolicy22'],mutationPerformed:false},
  daechiSuccessor:{root:opsRoot('daechi-hwpx-20261022/feedback-20261022'),state:'v2-delivery-producer-native-checks-observed-not-independent-source-certification',sourceIds:['S-finalF','S-verifyF','S-copyF','S-metricsF','S-guidanceF'],clipboardRoundtrip:'not-exercised',selectedBlockTransfer:'observed-Q18'},
  hancom:{corpus:'research/hancom/2026-10-22',manifestSha256:sha256(await readFile(resolve(root,'research/hancom/2026-10-22/index/manifest.json'))),scope:'official-documentation-catalog-with-local-qualification-links'},
  layouts:{profiles:'layout-profiles.json',formatIndependent:true,selection:'explicit-choice -> preserve-known-existing -> ask-for-choice',sourceIds:['S-layout-direction','S-hwp-handoff','S-hwp-verification','S-hwp-procedure']},
  retrievalExperiments:{sourceIds:['S-benchmark-measurements','S-benchmark-grading','S-jev-measurements','S-jev-audit'],canonicalEvalRunId:null,savingsEstablished:false},
  selectedImageEdit:{surface:'format',capabilityFamilyIds:['pictures','drawing','format-model','object-layout'],routeId:'selected-image-edit',procedureId:'P-selected-image-patch',
    sourceIds:['S-imagepatch-guide','S-imagepatch-receipt','S-imagepatch-proof','S-imagepatch-job','S-imagepatch-code','S-imagepatch-entry'],
    eligibility:'Only selected figure marks/labels/fills/layers change; embedding canvas/size/crop/transform and question ownership stay fixed.',
    fallback:'Shared media or size/aspect/crop/owner changes require a declared local-layout route.',
    preservedEvidence:'Retain qualified unchanged text/math/table evidence by exact dependency identity; source ambiguities remain unresolved.'},
  canonicalContracts:['EvalDataset','VerificationUnit','Evaluator','EvalSuite','EvalRun','CaseResult','common.quality-improvement.v1','common.constrained-improvement.v1'],
  adapter:{state:'proposed',feedbackContract:'src/contracts.ts#FeedbackEvent',requiredBindings:['real native Work/Task/Run/attempt identity','exact source/output revisions','independent expected truth and rubric/evaluator versions','actual time/provider cost and unknown liabilities']},
  nativeLoopOwner:'native-codex',newRuntime:false,canonicalRegistrationPerformed:false,acceptanceDecision:null};
function opsRoot(name:string){return '/LOCAL_HOME/operations/'+name;}
const analysis={schema:'math-editing.meta-analysis.v1',classification:'derived-synthesis-with-source-references',
  axes:{hierarchy:'Document -> page -> question -> block -> run/figure/frame -> entity/mark. Knowledge hierarchy separately groups domain -> layer -> stage -> record.',
    topology:'Typed geometric incidence/ray/owner/equal-mark relations, plus a separate pipeline dependency graph; neither is reducible to folder placement.',
    structure:'Semantic content, mathematical construction, presentation, native question container and page template have separate ownership and revisions.',
    type:'Claims, mark provenance, coordinates, units, object kinds, evidence states and feedback attribution are discriminated; missing evidence remains unknown.'},
  findings:[
    {id:'A1',claim:'Evidence interpretation is the main repeated source of semantic defects; neat output and code execution do not establish original truth.',sources:['S-feedbackD','S-q11approx20','S-source21'],action:'Use source-mark inventories and typed claims before style cleanup.'},
    {id:'A2',claim:'Historical SVG paths provide appearance control and finite constructions but do not consistently carry executable semantic topology.',sources:['S-scenes20','S-figureD','S-ir-proposal20'],action:'Reuse renderers and migrate only affected entities to stable typed constructors; avoid a wholesale rewrite.'},
    {id:'A3',claim:'Equation whitespace has multiple layers; historical bounded widening and blanket safety padding must not be recalled as a completed narrowing algorithm.',sources:['S-width20','S-widthread20','S-compose21','S-authorD','S-authorF'],action:'Use exact native metrics, environment-bound cache keys and ink-to-following-glyph checks.'},
    {id:'A4',claim:'Question ownership and repeated page composition are different structures.',sources:['S-questionF','S-pageF','S-bindingsF'],action:'Keep whole-question native containers separate from local block layout and content-dependent page slots.'},
    {id:'A5',claim:'Research publication, installed code, response transport, native application, output verification and user completion differ.',sources:['S-hancom-research20','S-recovery20','S-source21','S-native21','S-accept21'],action:'Route by evidence class and exact capability scope rather than a single ready boolean.'},
    {id:'A6',claim:'Optimization needs frozen comparable attempts and typed dependency attribution; producer confidence and missing costs cannot fill evidence gaps.',sources:['S-evaluation20','S-eval22','S-feedbackD'],action:'Capture FeedbackEvent once and hand off to existing rubric/evaluator ownership; measure quality and total cost/time independently.'},
  ],
  backwardPropagation:{meaning:'Evidence-grounded error attribution and selective recomputation, not gradient training.',
    backward:['exact output defect -> native control/content node','node -> producing attempt and input revisions','attempt -> source mark/semantic/metric/layout decision','decision -> source region and actual authority'],
    forward:['choose bounded patch class','walk typed affected descendants','rebuild only invalidated outputs','retain failed/corrected pair and independent quality/cost/time evidence'],
    ambiguity:'Cause status stays suspected or unknown until supporting evidence exists.'},
  efficiencyPlan:{implemented:['stable record IDs','intent routing','bounded context packets','pinned source snapshots','stage impact and source trace queries','metadata-only inventory search'],
    proposed:['automatic producer dependency manifests beyond manually authored Daechi graph','environment fingerprint enforcement at every native metric reuse','mark-provenance classifier with independently labelled source regions','common-Harness regression case registration'],
    measurementsRequired:['routing success against held-out requests','tokens actually consumed per task','request-to-delivery and human correction time','source/mark errors and evaluator disagreements','provider-reported paid cost plus unknown liabilities','rebuild counts and unchanged-node preservation'],savingsObserved:null}};
const files:Record<string,unknown>={'manifest.json':manifest,'index.json':index,'sources.json':captures,'citations.json':citations,'stages.json':stages,'flows.json':flows,'routes.json':routes,'topology.json':graph,'analysis.json':analysis,'integrations.json':integrations,'layout-profiles.json':layoutProfiles,
  'inventory-summary.json':{capturedAt,byRoot,excluded,errors,scope:manifest.coverage},
  'maintenance.json':{schema:'math-editing.maintenance.v1',stableIds:true,immutableReleases:true,
    updatePolicy:['New sources are captured and curated, never automatically accepted.','Do not overwrite old release snapshots.','Revise records with explicit scope and source references; add route/citation regression examples.','Run build with a new YYYY-MM-DD.N, validate it, then advance current.json.','External source owners and historical acceptance remain unchanged.'],
    deprecationPolicy:'Keep IDs and replace contents only in a successor release; add superseded-by metadata before removing a route.',
    verificationInvalidation:{sourceBytes:'Source interpretation and all source-bound descendants.',topology:'Dependent geometry/assets/layout/native output.',labelOffset:'Local asset and embedding/layout/native region.',equationMetric:'Bound controls, layout, package and native spacing.',pageTemplate:'Page layout/package/native pagination; source meaning unchanged.'}},
};
for(const record of records)files[`records/${record.id}.json`]=record;
for(const [path,data]of Object.entries(files))await writeFile(resolve(temporary,path),json(data));
await writeFile(resolve(temporary,'inventory.jsonl'),inventory.map(row=>JSON.stringify(row)).join('\n')+'\n');
const checked=validateSnapshots(temporary,captures,records);
await writeFile(resolve(temporary,'build-checks.json'),json({at:new Date().toISOString(),counts,...checked,inventoryReadErrors:errors,acceptanceDecision:null}));
if(errors.length)throw new Error('Inventory read errors recorded; inspect temporary build before publication.');
await rename(temporary,destination);
console.log(json({status:'release-built-not-selected',release,destination,...counts,inventoryCount:inventory.length,sourceAccuracyAcceptance:null}));
