import {isDeepStrictEqual} from 'node:util';
import {sha256,requireValue,integer} from './admission.ts';
import {MODEL,ENDPOINT,type StageInput} from './contracts.ts';

export interface PolicyPin {path:string;sha256:string}
export const ROOT_SELECTION:Readonly<PolicyPin>=Object.freeze({
 path:'/LOCAL_HOME/operations/math-problem-optimization-20261020/progressive-jev/operational-reserve-selection.root.json',
 sha256:'298433b4fde66e3057afd7e96c5ea7f2e3a718977acddec4222ef55fbb55b668',
});
export const ORDINARY_OPERATION_ASSUMPTION='Published routing/metering/tariffs apply without abnormal undisclosed fan-out or ancillary fees consuming250000microUSD for one bounded closed request. Explicit assumption, not guaranteed universal fee ceiling or confirmed account configuration.';
export const RESERVE_MICRO_USD=250000 as const;
export interface OperationalReservePolicy {
 schema:'jev.operational-reserve-policy.v1';kind:'operational-reserve-v1';rootSelection:PolicyPin;
 ordinaryOperationAssumption:typeof ORDINARY_OPERATION_ASSUMPTION;
 caseId:'u5c5ff8d234';stageId:string;mode:'research'|'routing';bodySha256:string;
 pins:StageInput['pins'];packet:PolicyPin;request:PolicyPin;outputSchema:PolicyPin;pricing:PolicyPin;
 requestAdapter:PolicyPin;
 reservationMicroUsd:250000;maxOuterRequests:1;maxBodyBytes:32768;maxInputTokens:32000;
 maxResponseBytes:65536;maxOutputBytes:65536;externalSettlement:'unresolved-retain-full-reserve';
}
export interface ReserveBinding {
 kind:'operational-reserve-v1';policy:PolicyPin;rootSelection:PolicyPin;reservationMicroUsd:250000;
}
const hex=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const obj=(x:unknown):x is Record<string,any>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const keys=(x:unknown,names:string[])=>requireValue(obj(x)&&Object.keys(x).sort().join(',')===[...names].sort().join(','),'RESERVE_CLOSED_FIELDS');
function pin(x:PolicyPin){keys(x,['path','sha256']);requireValue(typeof x.path==='string'&&x.path.startsWith('/')&&hex(x.sha256),'RESERVE_PIN')}
export const operationalReserveHash=(p:OperationalReservePolicy)=>sha256(JSON.stringify(p));

/** Pure exact closed-request policy validation. An operational allocation is not an invoice ceiling. */
export function checkOperationalReserve(p:OperationalReservePolicy,input:StageInput,body:string,headers:Record<string,string>):250000 {
 keys(p,['schema','kind','rootSelection','ordinaryOperationAssumption','caseId','stageId','mode','bodySha256','pins','packet','request','outputSchema','pricing','requestAdapter','reservationMicroUsd','maxOuterRequests','maxBodyBytes','maxInputTokens','maxResponseBytes','maxOutputBytes','externalSettlement']);
 requireValue(p.schema==='jev.operational-reserve-policy.v1'&&p.kind==='operational-reserve-v1'&&p.caseId==='u5c5ff8d234'&&['research','routing'].includes(p.mode),'RESERVE_POLICY_KIND');
 for(const value of [p.rootSelection,p.packet,p.request,p.outputSchema,p.pricing,p.requestAdapter])pin(value);
 requireValue(isDeepStrictEqual(p.rootSelection,ROOT_SELECTION)&&p.ordinaryOperationAssumption===ORDINARY_OPERATION_ASSUMPTION,'RESERVE_ROOT_PREMISE');
 const publicRoot='/LOCAL_HOME/operations/math-problem-optimization-20261020/progressive-jev/execution/oracle/model-input/u5c5ff8d234/';
 requireValue(p.packet.path===publicRoot+'packet.json'&&p.packet.sha256==='56771ca3f2cf08dababd344436c5a006d8f2e16563286b1b75642f9af2fb24d5'&&p.request.path===publicRoot+'request.txt'&&p.request.sha256==='9a12390a08b9914d59b38a1457e14dcb9d64f574cbf99ed42e6cd18f3ac67a21','RESERVE_PUBLIC_CASE');
 requireValue(p.reservationMicroUsd===RESERVE_MICRO_USD&&p.maxOuterRequests===1&&p.maxBodyBytes===32768&&p.maxInputTokens===32000&&p.maxResponseBytes===65536&&p.maxOutputBytes===65536&&p.externalSettlement==='unresolved-retain-full-reserve','RESERVE_TERMS');
 keys(p.pins,['source','protocol','exposure','rubric','evaluator']);
 requireValue(!Object.hasOwn(input,'billing')&&input.caseId===p.caseId&&input.stageId===p.stageId&&input.mode===p.mode&&isDeepStrictEqual(input.pins,p.pins)&&Object.keys(p.pins).length===5&&Object.values(p.pins).every(hex),'RESERVE_INPUT_BINDING');
 requireValue(!Object.hasOwn(input,'image')&&!Object.hasOwn(input,'imageReference')&&!Object.hasOwn(input,'parentOutputSha256'),'RESERVE_NO_IMAGE_OR_CORRECTION');
 requireValue(hex(p.bodySha256)&&sha256(body)===p.bodySha256&&Buffer.byteLength(body)<=p.maxBodyBytes,'RESERVE_BODY_BINDING');
 requireValue(JSON.stringify(headers)==='{"Content-Type":"application/json"}','RESERVE_HEADERS');
 const request=JSON.parse(body);keys(request,['model','state','questions','providerOptions']);
 requireValue(request.model===MODEL&&typeof request.state==='string'&&request.state.length>0&&request.state===input.state&&isDeepStrictEqual(request.questions,input.questions),'RESERVE_BODY_FIELDS');
 requireValue(JSON.stringify(request.providerOptions)==='{"gateway":{"only":["typesafe-ai"],"models":[]}}','RESERVE_ROUTE');
 const qs=Object.values(input.questions);requireValue(qs.length===1&&['noul','choice'].includes(qs[0].type),'RESERVE_ONE_DISCRETE_QUESTION');
 return RESERVE_MICRO_USD;
}

export function checkRootSelection(p:OperationalReservePolicy,bytes:Uint8Array):void {
 requireValue(sha256(bytes)===ROOT_SELECTION.sha256,'RESERVE_SELECTION_BYTES');
 const s=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 requireValue(s.ordinaryOperationAssumption===p.ordinaryOperationAssumption&&s.firstRequest?.reservationMicroUsd===RESERVE_MICRO_USD&&s.firstRequest?.paidCapMicroUsd===10000000&&s.firstRequest?.priorLiabilityMicroUsd===23826&&s.paidCallsAdmitted===0,'RESERVE_SELECTION_TERMS');
}
export function checkOperationalPricing(p:OperationalReservePolicy,bytes:Uint8Array):void {
 requireValue(sha256(bytes)===p.pricing.sha256,'RESERVE_PRICING_PIN');
 const model=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)).data?.find((m:any)=>m.id===MODEL);
 // This validates the selected per-evaluation premise only, never all fee components/attempts.
 requireValue(model?.pricing?.input==='0.000000042'&&model.pricing.output==='0','RESERVE_PRICING_PREMISE');
}
export function externalHold(reportedGenerationMicroUsd:number){
 const a=integer(reportedGenerationMicroUsd);requireValue(a<=RESERVE_MICRO_USD,'OBSERVED_RESERVE_BREACH');
 return {reportedGenerationMicroUsd:a,retainedUnknownExternalMicroUsd:RESERVE_MICRO_USD-a,committedReservationMicroUsd:RESERVE_MICRO_USD,actualTotalMicroUsd:null,allFeesSettled:false as const,reservationRetained:true as const};
}
export function checkExternalHold(value:unknown,a:number):void {
 requireValue(isDeepStrictEqual(value,externalHold(a)),'RESERVE_RETAINED_ALLOCATION');
}
