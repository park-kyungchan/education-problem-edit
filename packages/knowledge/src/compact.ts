/** Bounded capability/API context. Exact evidence stays in the pinned corpus. */
export function compactLookup(original:any,budget:number){
  if(!Number.isInteger(budget)||budget<2000||budget>100000)throw new Error('max-chars must be 2000..100000');
  const result=structuredClone(original),evidence:Record<string,unknown>={};
  const visit=(value:any):any=>{
    if(Array.isArray(value))return value.map(visit);
    if(!value||typeof value!=='object')return value;
    const copy:Record<string,unknown>={};
    for(const [key,v]of Object.entries(value)){
      if(key==='evidence'&&v&&typeof v==='object'&&'documentId'in v){
        const e=v as any,id=`${e.documentId}:p${e.physicalPage}:${String(e.sourceSha256).slice(0,10)}`;
        evidence[id]={documentId:e.documentId,physicalPage:e.physicalPage,sourceSha256:e.sourceSha256,url:e.url};
        copy.evidenceRef=id;
      }else copy[key]=visit(v);
    }
    return copy;
  };
  const out=visit(result);
  out.evidenceIndex=evidence;out.omitted=[];out.retrievalSize={characters:0,tokenCount:null};
  out.readNext='api <exact-id> --kind parameter --field <omitted-field-id>; use --max-chars for a larger packet.';
  const omit=(kind:string,id:string)=>{let group=out.omitted.find((g:any)=>g.kind===kind);if(!group){group={kind,ids:[]};out.omitted.push(group);}group.ids.push(id);};
  const size=()=>JSON.stringify(out,null,2).length+1;
  const pruneEvidence=()=>{
    const encoded=JSON.stringify({...out,evidenceIndex:undefined});
    for(const id of Object.keys(out.evidenceIndex))if(!encoded.includes(JSON.stringify(id)))delete out.evidenceIndex[id];
  };
  let currentSize=size();
  for(let i=0;currentSize>budget-100&&i<1000;i++){
    let removed=false;
    if(out.webHits?.length>1){omit('web-reference',out.webHits.pop().id);removed=true;}
    else if(out.pageHits?.length>1){omit('page',out.pageHits.pop().id);removed=true;}
    else if(out.results?.length>1){omit('result',out.results.pop().id);removed=true;}
    else if(out.families?.length>1){omit('family',out.families.pop().id);removed=true;}
    else if(out.families?.[0]?.actionExamples?.length>1){omit('action-example',out.families[0].actionExamples.pop().id);removed=true;}
    else if(out.results?.[0]?.fields?.length>1){
      const item=out.results[0];item.availableFieldIds??=item.fields.map((f:any)=>f.id);
      omit('parameter-field',item.fields.pop().id);removed=true;
    }
    if(!removed)throw new Error('Capability/API context exceeds this budget; use a more specific query or a larger --max-chars.');
    pruneEvidence();
    currentSize=size();
  }
  out.retrievalSize.characters=currentSize;
  currentSize=size();
  out.retrievalSize.characters=currentSize;
  if(currentSize>budget)throw new Error('Capability packet budget exceeded');
  return out;
}
