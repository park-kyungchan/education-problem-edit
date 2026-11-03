import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { KnowledgeRecord, Stage, Flow, Route, SourceCapture, KnowledgeGraph, ReleaseManifest, StageId, LayoutProfile } from './contracts';
import { json, sha256, normalized, rankRoutes, affectedStages, validateDataset, validateSnapshots, checkSourceDrift } from './lib';
import { compactLookup } from './compact';
import { resolveLayout, validateLayoutProfiles } from './layouts';
const root=resolve(import.meta.dir,'..');
const args=process.argv.slice(2),command=args.shift()??'help';
function option(name:string,fallback?:string){const i=args.indexOf(name);if(i<0)return fallback;const value=args[i+1];if(!value||value.startsWith('--'))throw new Error(`Missing value for ${name}`);args.splice(i,2);return value;}
const releaseOption=option('--release');
if(command==='help'){
  console.log(json({commands:['route <request or intent-id> [--max-chars 12000]','layout list','layout resolve [--profile <id>] [--existing <id>] [--format hwp|hwpx]','show <record-id>','source <source-id>','trace <record-id>','impact <record-id or stage-id>','find <path-query> [--limit 12]','capability <query> [--surface desktop|web|format] [--limit 8]','api <ActionId|ParameterSetId|member> [--kind action|parameter|api]','validate','check-sources [source-id ...]','summary'],release:'Every command accepts --release YYYY-MM-DD.N; otherwise current.json selects the immutable release.'}));process.exit(0);
}
let release=releaseOption,expectedManifestSha:string|undefined;
if(!release){if(!existsSync(resolve(root,'current.json')))throw new Error('No selected release. Supply --release YYYY-MM-DD.N.');const current=JSON.parse(readFileSync(resolve(root,'current.json'),'utf8'));release=current.release;expectedManifestSha=current.manifestSha256;}
if(!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(release!))throw new Error('Invalid release');
const dir=resolve(root,'releases',release!);
if(expectedManifestSha&&sha256(readFileSync(resolve(dir,'manifest.json')))!==expectedManifestSha)throw new Error('Selected release manifest hash drift');
const load=<T>(path:string):T=>JSON.parse(readFileSync(resolve(dir,path),'utf8'));
const manifest=load<ReleaseManifest>('manifest.json'),index=load<{id:string;path:string;kind:string;stage:StageId;title:string}[]>('index.json');
const record=(id:string):KnowledgeRecord=>{const entry=index.find(e=>e.id===id);if(!entry)throw new Error(`Unknown record ${id}. Use route or find.`);return load(entry.path);};
const sources=()=>load<SourceCapture[]>('sources.json');
const source=(id:string)=>{const s=sources().find(s=>s.id===id);if(!s)throw new Error(`Unknown source ${id}`);return {...s,snapshotAbsolutePath:resolve(dir,s.snapshot)};};
const output=(data:unknown)=>console.log(json(data));
switch(command){
case 'layout':{
  if(!existsSync(resolve(dir,'layout-profiles.json')))throw new Error('This historical release predates selectable layout profiles; select a current release.');
  const profiles=load<LayoutProfile[]>('layout-profiles.json');validateLayoutProfiles(profiles,sources().map(s=>s.id));
  const action=args.shift();
  if(action==='list')output({release,profiles,selectionPolicy:'Explicit choice wins; preserve a known existing profile without a requested change; otherwise obtain the user choice. Layout and file format are independent.'});
  else if(action==='resolve')output({release,...resolveLayout(profiles,{requested:option('--profile'),existing:option('--existing'),format:option('--format')})});
  else throw new Error('Use layout list or layout resolve');
  break;
}
case 'summary':output({manifest,stages:load<Stage[]>('stages.json').map(({id,layer,invariant})=>({id,layer,invariant})),routeIds:load<Route[]>('routes.json').map(r=>r.id),analysis:resolve(dir,'analysis.json')});break;
case 'show':output({release,record:record(args[0]),citations:load<{recordId:string}[]>('citations.json').filter(c=>c.recordId===args[0]),next:'Use source <source-id> for pinned snapshot paths and current-original provenance.'});break;
case 'source':output({release,...source(args[0])});break;
case 'route':{
  const budget=Number(option('--max-chars','12000'));if(!Number.isInteger(budget)||budget<2000||budget>100000)throw new Error('max-chars must be 2000..100000');
  const query=args.join(' '),routes=load<Route[]>('routes.json'),ranked=rankRoutes(query,routes);
  if(!ranked.length){output({release,state:'unmapped',query,next:'Use capability for Hancom feature/API lookup, or find for operation path metadata.',availableIntents:routes.map(r=>r.id)});break;}
  const route=routes.find(r=>r.id===ranked[0].id)!;
  const procedures=route.procedureIds.map(record);
  const mandatoryRuleIds=[...new Set([...route.ruleIds,...procedures.flatMap(p=>p.kind==='procedure'?p.ruleIds:[])])];
  const mentionedQuestion=query.match(/(?:Q|q|문항\s*|문제\s*)?(\d{1,2})\s*(?:번)?/);
  const q=mentionedQuestion?Number(mentionedQuestion[1]):null;
  const specific=q===null?[]:index.filter(e=>e.kind==='case').map(e=>record(e.id)).filter(c=>c.kind==='case'&&c.exam==='daechi-20261022'&&c.question===q).map(c=>c.id);
  const caseIds=[...new Set([...specific,...route.caseIds])];
  const allIds=[...route.procedureIds,...mandatoryRuleIds,...caseIds];
  const detailIds=[...new Set([...route.procedureIds.slice(0,3),...route.ruleIds,...specific,...route.caseIds.slice(0,2),...mandatoryRuleIds])];
  const details=detailIds.map(id=>{
    const r=record(id),base={id:r.id,kind:r.kind,title:r.title,evidenceClass:r.evidenceClass,evidence:r.evidence,limitation:r.limitation};
    if(r.kind==='rule')return {...base,when:r.when,do:r.do,check:r.check};
    if(r.kind==='procedure')return {...base,inputs:r.inputs,steps:r.steps,outputs:r.outputs,stopWhen:r.stopWhen,implementationSourceIds:r.implementationSourceIds,...(r.behaviors?{behaviors:r.behaviors}:{})};
    return {...base,symptom:r.symptom,expected:r.expected,outcome:r.outcome};
  });
  const packet:any={schema:'math-editing.context-packet.v1',release,query,
    route:{id:route.id,title:route.title,stages:route.stages,outputContract:route.outputContract,escalation:route.escalation},
    alternatives:ranked.slice(1,3),selection:'Deterministic keyword/intent lookup; this is a retrieval suggestion, not an executed model or tool decision.',
    boundary:'Pinned historical observations, current requirements and proposed extensions remain distinct. No source acceptance or canonical activation is implied.',
    procedureIds:route.procedureIds,mandatoryRuleIds,caseIds,details,
    omittedDetailIds:[] as string[],readNext:'show <id>; source <source-id>; trace <id>; impact <id>',
    size:{characters:0,tokenCount:null,tokenCountReason:'Characters are bounded; actual model token usage is measured only in native Run evidence.'}};
  const omitted=new Set(allIds.filter(id=>!detailIds.includes(id)));
  for(let attempt=0;attempt<details.length+allIds.length+10;attempt++){
    packet.omittedDetailIds=[...omitted];packet.size.characters=json(packet).length;
    if(json(packet).length<=budget)break;
    const removed=packet.details.pop();if(!removed)throw new Error(`Budget too small for route metadata; use at least ${json(packet).length} characters.`);
    omitted.add(removed.id);
  }
  for(let i=0;i<3;i++)packet.size.characters=json(packet).length;
  if(json(packet).length>budget)throw new Error('Context packet exceeded requested character budget');
  output(packet);break;
}
case 'trace':{
  const r=record(args[0]),usedRules=r.kind==='rule'?[]:r.ruleIds.map(record);
  const evidence=[...new Set([r,...usedRules].flatMap(x=>x.evidence.map(e=>e.sourceId)))].map(source);
  output({release,record:r,ruleIds:usedRules.map(x=>x.id),upstreamStageEnvelope:affectedStages(r.stage,load<Flow[]>('flows.json'),true),evidence,
    scope:'Stage ancestors are a planning envelope. Exact producer-node attribution requires a FeedbackEvent and the producer dependency manifest.'});break;
}
case 'impact':{
  const id=args[0],stages=load<Stage[]>('stages.json');const stageId=(stages.some(s=>s.id===id)?id:record(id).stage) as StageId;
  output({release,target:id,stage:stageId,affectedStageEnvelope:affectedStages(stageId,load<Flow[]>('flows.json')),
    scope:'Conservative stage-level planning only. Inspect actual node/aspect dependencies before reuse/rebuild; following page slots may reflow even when their semantic content is unchanged.',
    exactDaechiNodeGraph:'Use the completed feedback handoff and its impact.ts/typed producer sidecars via capability or source S-optimizationF.'});break;
}
case 'find':{
  const limit=Number(option('--limit','12'));if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('limit must be 1..100');
  const query=normalized(args.join(' '));if(!query)throw new Error('Supply a path query');
  const rows=readFileSync(resolve(dir,'inventory.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  const matches=rows.filter(row=>normalized(row.path).includes(query));
  output({release,semanticReview:'inventory-only',count:matches.length,results:matches.slice(0,limit),truncated:matches.length>limit});break;
}
case 'check-sources':{
  const wanted=args.length?args:null,selected=sources().filter(s=>!wanted||wanted.includes(s.id));
  if(wanted&&selected.length!==new Set(wanted).size)throw new Error('Unknown source ID');
  const results=checkSourceDrift(selected);output({release,results,changed:results.filter(r=>r.state!=='same').length,policy:'Use captured snapshots for historical claims. Curate changed originals into a successor release; do not silently accept newer content.'});break;
}
case 'validate':{
  const allRecords=index.map(e=>record(e.id)),allSources=sources();
  const counts=validateDataset(load('stages.json'),load('flows.json'),allRecords,allSources,load('routes.json'),load<KnowledgeGraph>('topology.json'));
  if(existsSync(resolve(dir,'layout-profiles.json')))validateLayoutProfiles(load('layout-profiles.json'),allSources.map(s=>s.id));
  output({release,status:'passed',...counts,...validateSnapshots(dir,allSources,allRecords),sourceAcceptance:null});break;
}
case 'capability':case 'api':{
  const budget=Number(option('--max-chars','8000'));
  const integration=load<any>('integrations.json');
  if(integration.hancom){
    const actual=sha256(readFileSync(resolve(root,integration.hancom.corpus,'index/manifest.json')));
    if(actual!==integration.hancom.manifestSha256)throw new Error('Hancom corpus changed since this release. Curate/build a successor release before using updated declarations.');
  }
  const {queryHancom}=await import('./hancom');
  const lookup:any=queryHancom(root,command,args),imageEdit=integration.selectedImageEdit;
  if(command==='capability'&&imageEdit&&lookup.families?.some((f:any)=>imageEdit.capabilityFamilyIds.includes(f.id))){
    lookup.localWorkflow={...imageEdit,next:'route selected-image-edit --max-chars 6000; show P-selected-image-patch; source S-imagepatch-job',
      boundary:'Observed finite package/media patch route; no claim of arbitrary native vector editing or automatic eligibility validation.'};
  }
  output(compactLookup(lookup,budget));break;
}
default:throw new Error(`Unknown command ${command}; use help`);
}
