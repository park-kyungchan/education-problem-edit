import {createHash} from 'node:crypto';
import config from './public-contract.json';
import {CONTRACT_SHA256} from './frozen-public.ts';

/** Pure public adapter. No transport, process, filesystem, target or evaluator access. */
export const QUERY_IDS=['q1','q2','none_needed','insufficient_candidates'] as const;
export type QueryId=typeof QUERY_IDS[number];
export type MicroOutput={benchmarkId:string;caseId:string;packetSha256:string;nextQuery:QueryId};
export type Bindings={benchmarkId:string;caseId:string;packetSha256:string;stateSha256:string;bodySha256:string};
export const sha256=(b:string)=>createHash('sha256').update(b).digest('hex');
export function requireValue(v:unknown,code:string):asserts v {if(!v)throw Error(code);}
export function record(v:unknown):v is Record<string,unknown>{return v!==null&&typeof v==='object'&&!Array.isArray(v);}
export function exactKeys(v:Record<string,unknown>,keys:readonly string[]){requireValue(Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)),'CLOSED_KEYS');}
const probability=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1;
function verifyContract(){requireValue(sha256(JSON.stringify(config))===CONTRACT_SHA256,'PUBLIC_CONTRACT_HASH');}
export function expectedBindings():Bindings{
 verifyContract();
 return {benchmarkId:config.benchmarkId,caseId:config.caseId,packetSha256:config.packetSha256,stateSha256:config.stateSha256,bodySha256:config.bodySha256};
}
function validateBindings(v:unknown):Bindings{
 const expected=expectedBindings();requireValue(record(v),'BINDINGS_OBJECT');
 exactKeys(v,Object.keys(expected));
 for(const [k,value]of Object.entries(expected))requireValue(v[k]===value,'BINDING:'+k);
 return {...expected};
}
export function buildNextQueryQuestion(packetBytes:string){
 verifyContract();requireValue(typeof packetBytes==='string'&&sha256(packetBytes)===config.packetSha256,'PACKET_HASH');
 const packet=JSON.parse(packetBytes);
 const state=JSON.stringify({caseId:packet.caseId,evidence:packet.evidence});
 requireValue(state===config.state&&sha256(state)===config.stateSha256,'STATE_HASH');
 requireValue(sha256(JSON.stringify(config.question))===config.questionSha256,'QUESTION_HASH');
 requireValue(sha256(JSON.stringify(config.outputSchema))===config.schemaSha256,'SCHEMA_HASH');
 const question=structuredClone(config.question);
 const body={model:'typesafe-ai/jev-1.14.0',state,questions:{next_query:question},providerOptions:{gateway:{only:['typesafe-ai'],models:[]}}};
 const bodyJson=JSON.stringify(body);
 requireValue(bodyJson===config.bodyJson&&sha256(bodyJson)===config.bodySha256,'BODY_HASH');
 requireValue(Buffer.byteLength(bodyJson)<=32768,'BODY_BOUND');
 return {bindings:expectedBindings(),state,question,bodyJson,outputSchema:structuredClone(config.outputSchema),liveAdmission:false as const};
}
function makeOutput(nextQuery:unknown):MicroOutput{
 requireValue(typeof nextQuery==='string'&&QUERY_IDS.includes(nextQuery as QueryId),'QUERY_ID');
 const b=expectedBindings();
 return {benchmarkId:b.benchmarkId,caseId:b.caseId,packetSha256:b.packetSha256,nextQuery:nextQuery as QueryId};
}
export function validateMicroOutput(v:unknown):MicroOutput{
 verifyContract();requireValue(record(v),'OUTPUT_OBJECT');
 exactKeys(v,['benchmarkId','caseId','packetSha256','nextQuery']);
 const b=expectedBindings();
 for(const k of ['benchmarkId','caseId','packetSha256'] as const)requireValue(v[k]===b[k],'OUTPUT_BINDING:'+k);
 return makeOutput(v.nextQuery);
}
/** Input is the typed answers object only. This does not qualify provider provenance. */
export function projectValidatedChoice(answers:unknown,bindings:unknown):MicroOutput{
 validateBindings(bindings);requireValue(record(answers),'ANSWERS_OBJECT');exactKeys(answers,['next_query']);
 const a=answers.next_query;requireValue(record(a),'CHOICE_OBJECT');exactKeys(a,['type','choice','confidence','probabilities']);
 requireValue(a.type==='choice'&&probability(a.confidence),'CHOICE_TYPE_CONFIDENCE');
 requireValue(record(a.probabilities),'PROBABILITIES_OBJECT');exactKeys(a.probabilities,QUERY_IDS);
 const values=Object.values(a.probabilities);requireValue(values.every(probability),'PROBABILITY_RANGE');
 // Preserve existing native source tolerance; no post-result normalization/argmax.
 requireValue(Math.abs(values.reduce((sum,n)=>sum+n,0)-1)<1e-6,'PROBABILITY_SUM');
 return makeOutput(a.choice);
}
/** A distinct micro method: parse structured final text supplied by a future native owner. */
export function parseNativeMicroFinalText(text:unknown,bindings:unknown):MicroOutput{
 validateBindings(bindings);
 requireValue(typeof text==='string'&&text.trim().length>0&&Buffer.byteLength(text)<=8192,'FINAL_TEXT_BOUND');
 const output=validateMicroOutput(JSON.parse(text));
 // This schema is a flat object of fixed/enum strings. Detect duplicate textual
 // keys too; JSON.parse alone silently keeps the last occurrence.
 const keys=[...text.matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)].map(m=>JSON.parse(m[1]!));
 requireValue(keys.length===4&&new Set(keys).size===4,'DUPLICATE_FINAL_KEY');
 return output;
}
export function extractSuppliedQuery(packetBytes:string,output:unknown){
 buildNextQueryQuestion(packetBytes);const result=validateMicroOutput(output);
 if(result.nextQuery==='none_needed'||result.nextQuery==='insufficient_candidates')return null;
 const packet=JSON.parse(packetBytes);
 const matches=packet.evidence.queries.filter((q:{id:string})=>q.id===result.nextQuery);
 requireValue(matches.length===1,'PUBLIC_QUERY_MATCH');
 const {id,url,purpose}=matches[0];
 return {id,url,purpose}; // Candidate public data only; no route/authorization/execution.
}
// Full research projection deliberately omitted: the old fullcase wrapper remains HOLD.
