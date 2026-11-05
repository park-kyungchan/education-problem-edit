/** Compact deterministic review routing; feature detection is not semantic certification. */
import {createHash} from "node:crypto";
import type {prepareNativeBatch} from "./native-production";
export function planProductionAudit(batch:ReturnType<typeof prepareNativeBatch>){
 const routes:Record<string,{contract:string;check:string;templateIds:string[]}>= {};
 const add=(id:string,t:any,contract:string,check:string)=>{(routes[id]??={contract,check,templateIds:[]}).templateIds.push(t.id);};
 for(const t of batch.templates){
  // Skip quoted/text payloads when routing syntax; exact source review still owns meaning.
  const s=t.latex.replace(/"(?:\\.|[^"\\])*"|\\text\{[^{}]*\}/g,"");
  if(t.limitApproaches.length)add('limit-approaches',t,'src/limit-contract.ts','Check variable, endpoint, direction and source sign position; signed endpoints are distinct from one-sided signs.');
  if(t.limitApproaches.some((a:any)=>a.direction!=='two-sided'))add('one-sided-source-evidence',t,'src/limit-contract.ts','Explicit source-grounded direction/signPlacement required; missing or conflicting annotation blocks conversion.');
  if(/\\begin\{cases\}/.test(s))add('cases-boundaries',t,'src/production.ts','Compare each branch expression, strict/non-strict boundary and complete domain against the source crop.');
  if(/\\sqrt\b/.test(s))add('radical-scope',t,'src/production.ts','Verify the complete radicand and every term outside the radical against source.');
  if(/\\frac\b|\\over\b/.test(s))add('fraction-scope',t,'src/production.ts','Verify numerator/denominator scope and signs against source.');
  if(/\\(?:overline|bar|widehat|hat|vec|overrightarrow|overset)\b/.test(s))add('decorated-base-scope',t,'packages/native-production/compose.py','Distinguish external scripts on the whole decorated base from scripts inside the accent operand.');
  if(/'|\\prime\b/.test(s))add('derivative-scope',t,'src/production.ts','Verify derivative order, evaluation argument and any external power; do not infer a source reading from a solved answer.');
  if(/[\^_]/.test(s))add('scripts-and-arguments',t,'src/production.ts','Compare exponent/subscript base and scope; distinguish powers, indices and limit direction markers.');
  if(/\\(?:leq|geq|neq)\b|[<>|]/.test(s))add('relations-and-absolute-values',t,'src/production.ts','Verify relation direction, equality boundary and absolute-value scope against source.');
 }
 const equations=batch.packets.reduce((n:any,q:any)=>n+q.blocks.reduce((k:any,b:any)=>k+[...(b.atoms??[]),...(b.titleAtoms??[]),...(b.items??[]).flatMap((i:any)=>i.atoms)].filter((a:any)=>a.kind==='equation').length,0),0);
 return {schema:'problem-edit.production-audit.v1',sourceSha256:batch.sourceSha256,
  inputDigest:createHash('sha256').update(JSON.stringify(batch.inputPins)).digest('hex'),
  counts:{questions:batch.packets.length,equationTemplates:batch.templates.length,equationOccurrences:equations,limitApproaches:batch.templates.reduce((n,t)=>n+t.limitApproaches.length,0)},
  sources:batch.packets.map((q:any)=>({questionId:q.questionId,crop:q.source.cropPath,cropSha256:q.source.cropSha256})),
  routes:Object.entries(routes).map(([id,r])=>({id,...r})),
  automatic:['Pinned source/crop/input identity','Occurrence identity and explicit one-sided approach contract','Exact terminal half-space before measurement; saved bindings/native cells'],
  sourceReviewRequired:'Review routed scopes against the actual printed source. No route, stage=done flag or passing structural check certifies all mathematical meaning.',
  artifactReadback:'production inspect --file <version-directory> --root <run-root> --python <python>',nativeHancomStatus:'unknown'};
}
