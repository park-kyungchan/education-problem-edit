import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { KnowledgeRecord, Route, Stage, Flow, KnowledgeGraph, SourceCapture, Citation, StageId } from './contracts';
export const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
export const json = (value: unknown) => JSON.stringify(value,null,2)+'\n';
export function pointerValue(data: unknown,pointer: string): unknown {
  if(pointer==='')return data;
  if(!pointer.startsWith('/'))throw new Error(`Invalid JSON pointer: ${pointer}`);
  let value: unknown=data;
  for(const part of pointer.slice(1).split('/').map(x=>x.replaceAll('~1','/').replaceAll('~0','~'))){
    if(value===null || typeof value!=='object' || !Object.hasOwn(value,part))throw new Error(`Unresolved JSON pointer: ${pointer}`);
    value=(value as Record<string,unknown>)[part];
  }
  return value;
}
export function citationLocator(citation: Citation,text: string) {
  if(citation.pointer!==undefined)pointerValue(JSON.parse(text),citation.pointer);
  let lines: [number,number]|null=null;
  if(citation.contains){
    const index=text.indexOf(citation.contains);
    if(index<0)throw new Error(`Missing citation fragment ${citation.sourceId}: ${citation.contains}`);
    const start=text.slice(0,index).split('\n').length;
    lines=[start,start+citation.contains.split('\n').length-1];
  }
  return { ...citation, lines };
}
export function makeGraph(stages: Stage[],flows: Flow[],records: KnowledgeRecord[],sources: SourceCapture[]): KnowledgeGraph {
  const layers=[...new Set(stages.map(s=>s.layer))];
  const nodes: KnowledgeGraph['nodes']=[{id:'domain:math-editing',kind:'domain'},...layers.map(id=>({id:`layer:${id}`,kind:'layer' as const})),
    {id:'layer:source-library',kind:'layer'},...stages.map(s=>({id:`stage:${s.id}`,kind:'stage' as const})),
    ...records.map(r=>({id:r.id,kind:'record' as const})),...sources.map(s=>({id:s.id,kind:'source' as const}))];
  const edges: KnowledgeGraph['edges']=[...layers.map(id=>({from:'domain:math-editing',to:`layer:${id}`,relation:'contains' as const})),
    {from:'domain:math-editing',to:'layer:source-library',relation:'contains'},
    ...stages.map(s=>({from:`layer:${s.layer}`,to:`stage:${s.id}`,relation:'contains' as const})),
    ...sources.map(s=>({from:'layer:source-library',to:s.id,relation:'contains' as const})),
    ...records.map(r=>({from:`stage:${r.stage}`,to:r.id,relation:'contains' as const})),
    ...flows.map(f=>({from:`stage:${f.from}`,to:`stage:${f.to}`,relation:'feeds' as const})),
    ...records.flatMap(r=>r.evidence.map(e=>({from:r.id,to:e.sourceId,relation:'supported-by' as const}))),
    ...records.flatMap(r=>r.kind==='rule'?[]:r.ruleIds.map(id=>({from:r.id,to:id,relation:'uses-rule' as const}))),
    ...records.flatMap(r=>r.kind!=='procedure'?[]:r.implementationSourceIds.map(id=>({from:r.id,to:id,relation:'implements' as const}))),
  ];
  return {nodes,edges};
}
export function assertDag(ids:string[], edges:{from:string;to:string}[],label:string) {
  const allowed=new Set(ids), visiting=new Set<string>(),done=new Set<string>();
  for(const e of edges)if(!allowed.has(e.from)||!allowed.has(e.to))throw new Error(`${label}: dangling edge ${e.from} -> ${e.to}`);
  const visit=(id:string)=>{
    if(visiting.has(id))throw new Error(`${label}: cycle at ${id}`);
    if(done.has(id))return;
    visiting.add(id);
    for(const e of edges)if(e.from===id)visit(e.to);
    visiting.delete(id);done.add(id);
  };
  ids.forEach(visit);
}
export function validateDataset(stages: Stage[],flows: Flow[],records: KnowledgeRecord[],sources: SourceCapture[],routes: Route[],graph: KnowledgeGraph) {
  const unique=(ids:string[],label:string)=>{if(new Set(ids).size!==ids.length)throw new Error(`Duplicate ${label} ID`);};
  unique(stages.map(s=>s.id),'stage');unique(records.map(r=>r.id),'record');unique(sources.map(s=>s.id),'source');unique(routes.map(r=>r.id),'route');unique(graph.nodes.map(n=>n.id),'graph');
  const stageIds=new Set(stages.map(s=>s.id)); const recordMap=new Map(records.map(r=>[r.id,r])); const sourceMap=new Map(sources.map(s=>[s.id,s]));
  for(const r of records){
    if(!stageIds.has(r.stage))throw new Error(`Unknown record stage ${r.id}`);
    if(!['observed-code','historical-receipt','user-requirement','proposal','derived-guidance'].includes(r.evidenceClass))throw new Error(`Invalid evidence class ${r.id}`);
    if(!r.evidence.length || !r.limitation)throw new Error(`Missing evidence/limitation ${r.id}`);
    for(const e of r.evidence)if(!sourceMap.has(e.sourceId))throw new Error(`Unknown source ${e.sourceId}`);
    if(r.kind==='rule'){for(const id of r.invalidates)if(!stageIds.has(id))throw new Error(`Unknown invalidation stage ${id}`);}
    else for(const id of r.ruleIds)if(recordMap.get(id)?.kind!=='rule')throw new Error(`Unknown rule ${id}`);
    if(r.kind==='procedure'){
      for(const id of r.implementationSourceIds)if(!sourceMap.has(id))throw new Error(`Unknown implementation ${id}`);
      for(const behavior of r.behaviors??[])for(const id of behavior.sourceIds)if(!sourceMap.has(id))throw new Error(`Unknown behavior evidence ${id}`);
    }
    if(r.kind==='case'&&r.metric.measuredSavings!==null)throw new Error(`Unmeasured savings promoted in ${r.id}`);
  }
  for(const route of routes){
    for(const id of route.stages)if(!stageIds.has(id))throw new Error(`Unknown route stage ${id}`);
    for(const [ids,kind] of [[route.procedureIds,'procedure'],[route.ruleIds,'rule'],[route.caseIds,'case']] as const)
      for(const id of ids)if(recordMap.get(id)?.kind!==kind)throw new Error(`Invalid route reference ${route.id} -> ${id}`);
  }
  assertDag(stages.map(s=>s.id),flows,'pipeline dependency');
  const nodeIds=graph.nodes.map(n=>n.id),contains=graph.edges.filter(e=>e.relation==='contains');
  const nodeSet=new Set(nodeIds);
  for(const e of graph.edges)if(!nodeSet.has(e.from)||!nodeSet.has(e.to))throw new Error(`Dangling graph edge ${e.from} -> ${e.to}`);
  assertDag(nodeIds,contains,'containment');
  for(const id of nodeIds){const parents=contains.filter(e=>e.to===id).length;if(parents!==(id==='domain:math-editing'?0:1))throw new Error(`Hierarchy parent cardinality ${id}: ${parents}`);}
  return {stages:stages.length,records:records.length,sources:sources.length,routes:routes.length,graphNodes:graph.nodes.length,graphEdges:graph.edges.length};
}
export function validateSnapshots(releaseRoot:string,sources:SourceCapture[],records:KnowledgeRecord[]) {
  const textById=new Map<string,string>();
  for(const s of sources){
    const data=readFileSync(resolve(releaseRoot,s.snapshot));
    if(sha256(data)!==s.sha256)throw new Error(`Snapshot hash mismatch ${s.id}`);
    textById.set(s.id,data.toString('utf8'));
  }
  let selectors=0;
  for(const r of records)for(const e of r.evidence){citationLocator(e,textById.get(e.sourceId)!);selectors++;}
  return {snapshots:sources.length,citations:selectors};
}
export const normalized=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\s_\-./]+/gu,'');
export function rankRoutes(query:string,routes:Route[]) {
  const q=normalized(query);
  if(!q)return [];
  const combos:Record<string,string[][]>={
    'equation-spacing':[['수식','공백'],['수식','간격'],['수식','좁'],['equation','space']],
    'frame-alignment':[['보기','정렬'],['수식','정렬'],['박스','정렬']],
    'question-copy':[['문항','테이블'],['문제','복사']],
    'native-transfer':[['q18','transfer'],['문항','전송'],['selected','block']],
    'page-layout':[['페이지','문제'],['페이지','문항']],
  };
  return routes.map(route=>{
    const matches=route.keywords.filter(k=>q.includes(normalized(k)));
    const comboMatches=(combos[route.id]??[]).filter(words=>words.every(w=>q.includes(normalized(w))));
    const score=q===normalized(route.id)?1000:matches.reduce((n,k)=>n+Math.min(18,6+normalized(k).length),0)+comboMatches.length*25;
    return {id:route.id,title:route.title,score,matches,comboMatches};
  }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
}
export function affectedStages(stageId:StageId,flows:Flow[],reverse=false):StageId[] {
  const found=new Set<StageId>([stageId]),queue=[stageId];
  while(queue.length){const current=queue.shift()!;for(const f of flows){const from=reverse?f.to:f.from,to=reverse?f.from:f.to;if(from===current&&!found.has(to)){found.add(to);queue.push(to);}}}
  return [...found];
}
export function checkSourceDrift(sources:SourceCapture[]) {
  return sources.map(s=>{
    if(!existsSync(s.path))return {id:s.id,state:'missing',path:s.path,capturedSha256:s.sha256,currentSha256:null};
    const currentSha256=sha256(readFileSync(s.path));
    return {id:s.id,state:currentSha256===s.sha256?'same':'changed',path:s.path,capturedSha256:s.sha256,currentSha256};
  });
}
