import {checkBilling,certificateHash} from './billing.ts';
import {checkOperationalReserve,operationalReserveHash} from './operational-reserve.ts';
import {randomUUID} from 'node:crypto';
import {redactSecrets,parseUsdStringToMicroUsd,computeReservationCeilingMicroUsd} from '../budget.ts';
import {parseImageHeaderDimensions,checkJevNativeImageBounds} from '../stages.ts';
import {sha256,requireValue,integer} from './admission.ts';
import {MODEL,ENDPOINT,type StageInput,type Prepared,type Held,type Json,type TypedResult} from './contracts.ts';

export const PRICING_SHA256='de770d03cbccdf9f6174759a8e449d41376100169fea976312ce133a734dd981';
export const newLocalRequestId=()=>`local_${randomUUID()}`;
const object=(x:unknown):x is Record<string,any>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const prob=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1;
const pin=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function keysOnly(x:object,keys:string[]):void{requireValue(Object.keys(x).every(k=>keys.includes(k)),'UNSUPPORTED_FIELD')}
const text=(x:unknown)=>typeof x==='string'&&x.length>0&&Buffer.byteLength(x)<=8192;

/** Pure protocol builder. Prepared is never permission; liveHold is always retained. */
export function prepareJev(input:StageInput):Prepared|Held {
  try{
    requireValue(input&&object(input),'INVALID_STAGE_INPUT');
    keysOnly(input,['caseId','stageId','mode','state','questions','image','imageReference','pins','parentOutputSha256','billing','operationalReserve']);
    const reserve=Object.hasOwn(input,'operationalReserve');
    requireValue(!reserve||!!input.operationalReserve&&!Object.hasOwn(input,'billing'),'MIXED_OR_INVALID_FINANCIAL_POLICY');
    requireValue(text(input.caseId)&&text(input.stageId)&&['text','research','routing','box','presence'].includes(input.mode),'UNSUPPORTED_MODE');
    requireValue(object(input.pins)&&Object.keys(input.pins).length===5&&Object.values(input.pins).every(pin),'MISSING_EXPOSURE_PINS');
    if(input.parentOutputSha256!==undefined)requireValue(pin(input.parentOutputSha256),'INVALID_CORRECTION_PIN');
    requireValue(object(input.questions)&&Object.keys(input.questions).length>0&&Object.keys(input.questions).length<=16,'QUESTION_BOUND');
    for(const [id,q]of Object.entries(input.questions)){
      requireValue(/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(id)&&object(q)&&text(q.instructions),'INVALID_QUESTION');
      if(q.type==='choice'){
        keysOnly(q,['type','instructions','criteria']);
        requireValue(object(q.criteria)&&Object.keys(q.criteria).length>=2&&Object.keys(q.criteria).length<=255&&Object.entries(q.criteria).every(([k,v])=>/^[A-Za-z0-9_-]{1,64}$/.test(k)&&text(v)),'INVALID_CHOICE');
      }else{keysOnly(q,['type','instructions']);requireValue(['noul','box'].includes(q.type),'UNSUPPORTED_QUESTION');}
    }
    const hasBox=Object.values(input.questions).some(q=>q.type==='box');
    const imageMode=input.mode==='box'||input.mode==='presence';
    requireValue(!hasBox||input.mode==='box','BOX_MODE_REQUIRED');
    requireValue(imageMode===!!input.image,'IMAGE_MODE_MISMATCH');
    let state:Json=input.state; let assets:Record<string,unknown>|undefined;
    const headers:Record<string,string>={'Content-Type':'application/json'};
    if(input.image){
      requireValue(input.image.byteLength<=16*1024*1024,'IMAGE_BYTES_EXCEEDED');
      const meta=parseImageHeaderDimensions(input.image);
      requireValue(checkJevNativeImageBounds(meta).passed,'IMAGE_DIMENSION_LIMIT');
      requireValue(typeof input.imageReference==='string'&&/^[a-zA-Z0-9-]{8,64}$/.test(input.imageReference),'IMAGE_REFERENCE_REQUIRED');
      requireValue(JSON.stringify(state).includes(input.imageReference),'IMAGE_REFERENCE_UNUSED');
      assets={[input.imageReference]:{type:'image',format:meta.mimeType==='image/png'?'png':'jpeg',data_base64:Buffer.from(input.image).toString('base64')}};
      headers['TypeSafe-Danger-Zone-Images']='true';
    }
    if(input.mode==='box'){
      requireValue(input.questions.box?.type==='box'&&input.questions.presence?.type==='noul'&&input.questions.count?.type==='choice','BOX_REQUIRES_PRESENCE_AND_COUNT');
      requireValue(Object.keys((input.questions.count as any).criteria).sort().join(',')==='none,one,several','BOX_COUNT_CRITERIA');
      requireValue(Object.values(input.questions).filter(q=>q.type==='box').length===1,'ONE_BOX_ONLY');
    }
    const body={model:MODEL,state,questions:input.questions,...(assets?{assets}:{}),providerOptions:{gateway:{only:['typesafe-ai'],models:[]}}};
    const bodyJson=JSON.stringify(body);
    // A local subset stricter than provider body limits. No tokenizer estimate is represented as measured usage.
    requireValue(Buffer.byteLength(bodyJson)<= (imageMode?32*1024*1024:reserve?32768:16*1024),'BODY_BYTES_EXCEEDED');
    if(reserve){
      const policy=input.operationalReserve!;
      const reservationMicroUsd=checkOperationalReserve(policy,input,bodyJson,headers);
      return {disposition:'prepared',input,model:MODEL,endpoint:ENDPOINT,bodyJson,bodySha256:sha256(bodyJson),headers,maxBodyBytes:32768,maxResponseBytes:65536,maxInputTokens:32000,maxOutputBytes:65536,liabilityCeilingMicroUsd:null,pricingSha256:policy.pricing.sha256,billingCertificateSha256:null,outputSchemaSha256:policy.outputSchema.sha256,reservationPolicy:{kind:'operational-reserve-v1',policySha256:operationalReserveHash(policy),reservationMicroUsd},liveHold:'EXACT_OPERATIONAL_POLICY_REVIEW_REQUEST_ADAPTER_AND_ROOT_DISPATCH_REQUIRED'};
    }
    const ceiling=input.billing?checkBilling(input.billing,input,bodyJson,headers):null;
    return {disposition:'prepared',input,model:MODEL,endpoint:ENDPOINT,bodyJson,bodySha256:sha256(bodyJson),headers,maxBodyBytes:imageMode?32*1024*1024:16*1024,maxResponseBytes:64*1024,maxInputTokens:input.billing?.maxInputTokens??0,maxOutputBytes:64*1024,liabilityCeilingMicroUsd:ceiling,pricingSha256:input.billing?.pricingSha256??PRICING_SHA256,billingCertificateSha256:input.billing?certificateHash(input.billing):null,outputSchemaSha256:input.billing?.outputSchemaSha256??null,
      liveHold:imageMode?'EXPERIMENTAL_IMAGE_GATEWAY_AND_BILLABLE_BOUND_UNVERIFIED':!input.billing?'BILLING_EVIDENCE_INCOMPLETE; ALL_LIVE_MODES_HELD':'INDEPENDENT_REVIEW_ORACLE_AND_EFFECT_TIME_BILLING_ADMISSION_REQUIRED'};
  }catch(e){return {disposition:'held',reason:e instanceof Error?e.message:'INVALID_STAGE_INPUT'};}
}

function choice(answer:any,q:Extract<StageInput['questions'][string],{type:'choice'}>):Json {
  requireValue(answer.type==='choice'&&Object.hasOwn(q.criteria,answer.choice)&&prob(answer.confidence)&&object(answer.probabilities),'INVALID_CHOICE_ANSWER');
  const names=Object.keys(q.criteria).sort();
  requireValue(Object.keys(answer.probabilities).sort().join(',')===names.join(',')&&Object.values(answer.probabilities).every(prob),'INVALID_CHOICE_DISTRIBUTION');
  requireValue(Math.abs(Object.values(answer.probabilities).reduce((s:number,v:any)=>s+v,0)-1)<1e-6,'INVALID_PROBABILITY_SUM');
  return {type:'choice',choice:answer.choice,confidence:answer.confidence,probabilities:answer.probabilities};
}
export function normalizeJev(raw:unknown,prepared:Prepared):TypedResult {
  requireValue(object(raw)&&object(raw.answers),'INVALID_RESPONSE');
  requireValue(Object.keys(raw.answers).sort().join(',')===Object.keys(prepared.input.questions).sort().join(','),'ANSWER_SCHEMA_MISMATCH');
  const answers:Record<string,Json>={};
  for(const [id,q]of Object.entries(prepared.input.questions)){
    const a=raw.answers[id];requireValue(object(a)&&a.type===q.type,'ANSWER_TYPE_MISMATCH');
    if(q.type==='choice')answers[id]=choice(a,q);
    else if(q.type==='noul'){requireValue(prob(a.noul),'INVALID_NOUL');answers[id]={type:'noul',noul:a.noul};}
    else{
      requireValue(object(a.box)&&Object.keys(a.box).sort().join(',')==='bottom,left,right,top'&&Object.values(a.box).every(prob)&&a.box.left<a.box.right&&a.box.top<a.box.bottom&&(a.confidence===null||prob(a.confidence)),'INVALID_SINGLE_BOX');
      answers[id]={type:'box',box:a.box,confidence:a.confidence};
    }
  }
  if(prepared.input.mode==='box'){
    const count=(answers.count as any).choice;
    if(count!=='one'){answers.box=null;answers.boxDisposition=count==='none'?'absent-model-claim':'multiple-targets-held';}
    else answers.boxDisposition='one-provisional-box';
  }
  const g=raw.provider_metadata?.gateway;
  requireValue(!raw.model||raw.model===MODEL,'RETURNED_MODEL_SUBSTITUTION');
  const usage=raw.usage;
  const inputTokens=usage?.input_tokens===undefined?null:integer(usage.input_tokens);
  const outputTokens=usage?.output_tokens===undefined?null:integer(usage.output_tokens);
  requireValue(!(prepared.input.billing||prepared.input.operationalReserve)||inputTokens===null||inputTokens<=prepared.maxInputTokens,'BILLABLE_INPUT_OVER_BOUND');
  const costUsd=typeof g?.cost==='string'?g.cost:null;
  const actualMicroUsd=costUsd===null?null:parseUsdStringToMicroUsd(costUsd);
  const routing=g?.routing;
  const serving=typeof routing?.canonicalSlug==='string'?routing.canonicalSlug:null;
  const provider=typeof routing?.finalProvider==='string'?routing.finalProvider:null;
  const generation=typeof g?.generationId==='string'&&g.generationId.length>0?g.generationId:null;
  const attempts=routing?.totalProviderAttemptCount===undefined?null:integer(routing.totalProviderAttemptCount);
  requireValue(attempts===null||attempts===1,'UNEXPECTED_PROVIDER_ATTEMPTS');
  const complete=raw.model===MODEL&&serving===MODEL&&provider==='typesafe-ai'&&generation!==null&&routing?.originalModelId===MODEL&&routing?.resolvedProvider==='typesafe-ai'&&Array.isArray(routing?.fallbacksAvailable)&&routing.fallbacksAvailable.length===0;
  requireValue(serving===null||serving===MODEL,'RETURNED_SERVING_MODEL_SUBSTITUTION');
  const provenance={requestedModel:MODEL,returnedModelEcho:typeof raw.model==='string'?raw.model:null,servingModel:serving,provider,generationId:generation,providerAttempts:attempts,complete,locations:['body.model (requested-model echo)','body.provider_metadata.gateway.routing','body.provider_metadata.gateway.generationId']};
  return {answers,provenance,returnedModel:typeof raw.model==='string'?raw.model:null,providerGenerationId:typeof g?.generationId==='string'?g.generationId:null,inputTokens,outputTokens,costUsd,actualMicroUsd,interpretationAccepted:false,confidenceAccuracyVerified:false};
}

export function safeEvidence(value:unknown,secrets:readonly string[]=[],maxBytes=4096):string{
  // Drop sensitive named fields before stringification, then apply canonical value redaction.
  const json=JSON.stringify(value,(key,v)=>/^(?:authorization|proxy-authorization|(?:x[-_])?api[-_]?key|(?:access|refresh|id)[-_]?token|token|password|cookie|set-cookie|secret)$/i.test(key)?'[REDACTED]':v)??'null';
  return Buffer.from(redactSecrets(json,secrets)).subarray(0,maxBytes).toString('utf8');
}
