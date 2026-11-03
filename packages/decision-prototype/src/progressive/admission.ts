import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {parseUsdStringToMicroUsd} from '../budget.ts';
import {CAP_MICRO_USD,MODEL,ENDPOINT, type LedgerInput,type NativeOwner,type Snapshot} from './contracts.ts';

export const sha256=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export function requireValue(ok:unknown,reason:string):asserts ok {if(!ok)throw Error(reason)}
export function integer(value:unknown):number {
  requireValue(Number.isSafeInteger(value)&&Number(value)>=0,'UNSAFE_NONNEGATIVE_INTEGER');
  return Number(value);
}
const sum=(a:number,b:number)=>integer(integer(a)+integer(b));
const hex=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
export function verifyOwner(owner:NativeOwner,expected:NativeOwner,bodySha256:string):void {
  requireValue(owner&&expected,'ROOT_DISPATCH_REQUIRED');
  requireValue(owner.ownerId!=='math-argon-lead'&&owner.ownerId!=='math-gpt-lead','HISTORICAL_OWNER_IMPERSONATION');
  for(const key of ['ownerId','threadId','taskId','dispatchSha256','sourceSha256','requestSha256','activePaidRequests'] as const){
    requireValue(owner[key]===expected[key]&&owner[key]!==undefined,'ROOT_BINDING_MISMATCH');
  }
  requireValue(owner.ownerId.length>0&&owner.threadId.length>0&&owner.taskId.length>0&&owner.activePaidRequests===1,'SINGLE_NATIVE_OWNER_REQUIRED');
  requireValue(hex(owner.dispatchSha256)&&hex(owner.sourceSha256)&&hex(owner.requestSha256)&&owner.requestSha256===bodySha256,'ROOT_HASH_BINDING');
}

/** Pure strict replay of supplied original bytes. Never opens or creates a ledger. */
export function reconcileNativeOwner(input:LedgerInput):Snapshot {
  requireValue(input.bytes&&input.bytes.length>0,'MISSING_LEDGER');
  const bytes=input.bytes;
  requireValue(integer(input.prefix.bytes)>0&&bytes.length>=input.prefix.bytes&&hex(input.prefix.sha256),'INVALID_PREFIX');
  requireValue(sha256(bytes.subarray(0,input.prefix.bytes))===input.prefix.sha256,'STALE_LEDGER_PREFIX');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  requireValue(text.endsWith('\n'),'TRUNCATED_LEDGER');
  requireValue(Array.isArray(input.unaccountedLiabilities)&&input.unaccountedLiabilities.length===0,'UNACCOUNTED_LIABILITY');
  const rows=text.trimEnd().split('\n').map(line=>JSON.parse(line));
  requireValue(rows.length>0&&rows.length<=100_000,'INVALID_LEDGER_LENGTH');
  const states=new Map<string,any>(); const requestOwners=new Map<string,string>();
  let baseline=0;
  for(let i=0;i<rows.length;i++){
    let r=rows[i];
    if(r?.schema==='jev.progressive.budget-event.v1'){
      requireValue(r.nativeOwner&&r.nativeOwner.ownerId===r.callerOwner&&!['math-argon-lead','math-gpt-lead'].includes(r.callerOwner)&&hex(r.nativeOwner.dispatchSha256)&&hex(r.nativeOwner.requestSha256)&&typeof r.nativeOwner.threadId==='string'&&typeof r.nativeOwner.taskId==='string'&&hex(r.receiptSha256)&&typeof r.receiptPath==='string','INVALID_PROGRESSIVE_LEDGER_BINDING');
      requireValue(['reservation-created','reservation-settled-actual','reservation-locked-uncertain'].includes(r.eventKind),'INVALID_PROGRESSIVE_EVENT');
      r={...r,schema:'math-editing.budget-ledger-entry.v1'};
    }
    requireValue(r&&r.schema==='math-editing.budget-ledger-entry.v1'&&r.sessionCapMicroUsd===CAP_MICRO_USD,'UNKNOWN_LEDGER_VARIANT');
    requireValue(typeof r.reservationId==='string'&&r.reservationId.length>0&&typeof r.requestKey==='string'&&r.requestKey.length>0&&typeof r.callerOwner==='string','INVALID_LEDGER_IDENTITY');
    integer(r.reservedMicroUsd); if(r.actualMicroUsd!==null)integer(r.actualMicroUsd);
    integer(r.effectiveCommittedMicroUsd);integer(r.cumulativeCommittedMicroUsd);integer(r.remainingBudgetMicroUsd);
    if(r.eventKind==='prior-spend-baseline'){
      requireValue(i===0&&r.status==='settled'&&r.actualMicroUsd===r.reservedMicroUsd&&r.actualMicroUsd>=11496,'INVALID_OR_REPEATED_BASELINE');
      baseline=r.actualMicroUsd;
    }else{
      const prev=states.get(r.reservationId);
      const priorId=requestOwners.get(r.requestKey);
      requireValue(!priorId||priorId===r.reservationId,'DUPLICATE_REQUEST_KEY');
      if(r.eventKind==='reservation-created'){
        requireValue(!prev&&r.status==='active-reserved'&&r.actualMicroUsd===null&&r.reservedMicroUsd>0,'DUPLICATE_OR_INVALID_RESERVATION');
      }else{
        requireValue(prev&&prev.requestKey===r.requestKey&&prev.callerOwner===r.callerOwner&&prev.reservedMicroUsd===r.reservedMicroUsd,'MISSING_OR_CHANGED_RESERVATION');
        requireValue(['active-reserved','uncertain-locked'].includes(prev.status),'TERMINAL_RESERVATION_REPLAY');
        if(r.eventKind==='reservation-settled-actual')requireValue(r.status==='settled'&&r.actualMicroUsd!==null,'INVALID_SETTLEMENT');
        else if(r.eventKind==='reservation-locked-uncertain')requireValue(r.status==='uncertain-locked'&&r.actualMicroUsd===null,'INVALID_UNCERTAINTY');
        else if(r.eventKind==='reservation-released-precall-abort')requireValue(r.status==='aborted-before-send'&&prev.status==='active-reserved'&&r.actualMicroUsd===null,'INVALID_PRECALL_RELEASE');
        else throw Error('UNKNOWN_LEDGER_EVENT');
      }
      states.set(r.reservationId,r);requestOwners.set(r.requestKey,r.reservationId);
    }
    const effective=(x:any)=>x.status==='settled'?integer(x.actualMicroUsd):x.status==='aborted-before-send'?0:integer(x.reservedMicroUsd);
    const running=[...states.values()].reduce((total,x)=>sum(total,effective(x)),baseline);
    const current=r.eventKind==='prior-spend-baseline'?baseline:effective(r);
    requireValue(r.effectiveCommittedMicroUsd===current&&r.cumulativeCommittedMicroUsd===running&&r.remainingBudgetMicroUsd===CAP_MICRO_USD-running&&running<=CAP_MICRO_USD,'LEDGER_ARITHMETIC_MISMATCH');
  }
  requireValue(baseline>=11496,'MISSING_BASELINE');
  const hold=input.missingOriginal; const old=states.get(hold.reservationId);
  requireValue(old&&old.status==='settled'&&old.actualMicroUsd===integer(hold.recordedMicroUsd)&&integer(hold.ceilingMicroUsd)>=hold.recordedMicroUsd,'MISSING_ORIGINAL_HOLD_UNACCOUNTED');
  // No caller-controlled release of the pinned 252 ceiling or its 96 supplement.
  requireValue(hold.recordedMicroUsd===156&&hold.ceilingMicroUsd===252,'ORIGINAL_HOLD_WEAKENED');
  const research=input.research;
  requireValue(research&&hex(research.sha256)&&sha256(research.response)===research.sha256,'MISSING_OR_CHANGED_RESEARCH_RECEIPT');
  const decode=(b:Uint8Array)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
  const response=decode(research.response);
  requireValue(response?.schema==='math-optimization.jev-research-raw-response.v1'&&response.httpStatus===200&&response.requestedModel===MODEL&&response.endpoint===ENDPOINT,'RESEARCH_ENVELOPE_STATUS');
  requireValue(hex(research.requestBodySha256)&&hex(research.rawBodySha256)&&typeof response.rawBody==='string'&&sha256(response.rawBody)===research.rawBodySha256,'RESEARCH_RAW_BODY_DIGEST');
  requireValue(isDeepStrictEqual(JSON.parse(response.rawBody),response.body),'RESEARCH_RAW_BODY_JOIN');
  const gateway=response.body?.provider_metadata?.gateway;
  requireValue(response.body?.model===MODEL&&gateway&&gateway.generationId===research.generationId&&typeof gateway.cost==='string','RESEARCH_ID_OR_COST_MISMATCH');
  for(const evidence of [research.request,research.requestBody,research.settlement])requireValue(evidence&&hex(evidence.sha256)&&sha256(evidence.bytes)===evidence.sha256,'RESEARCH_PROVENANCE_DIGEST');
  const request=decode(research.request.bytes),settlement=decode(research.settlement.bytes),requestBody=decode(research.requestBody.bytes);
  requireValue(request.schema==='math-optimization.jev-research-request-manifest.v1'&&request.endpoint===ENDPOINT&&request.requestedModel===MODEL&&request.requestCount===1&&request.retries===0&&Array.isArray(request.fallbackModels)&&request.fallbackModels.length===0,'RESEARCH_REQUEST_ENVELOPE');
  requireValue(requestBody.model===MODEL&&sha256(JSON.stringify(requestBody))===research.requestBodySha256&&request.bodySha256===research.requestBodySha256&&request.expectedBodySha256===research.requestBodySha256&&response.requestBodySha256===research.requestBodySha256,'RESEARCH_REQUEST_BODY_JOIN');
  requireValue(settlement.schema==='math-optimization.jev-research-settlement.v1'&&settlement.httpStatus===200&&settlement.status==='settled-original-response'&&settlement.paidCallsExecuted===1&&settlement.reservationId===research.reservationId&&settlement.responsePath===research.responsePath&&settlement.returnedModel===MODEL,'RESEARCH_SETTLEMENT_JOIN');
  requireValue(settlement.gateway?.generationId===research.generationId&&settlement.gateway?.cost===gateway.cost&&settlement.reportedCostUsd===gateway.cost&&isDeepStrictEqual(settlement.gateway,gateway)&&isDeepStrictEqual(settlement.usage,response.body.usage),'RESEARCH_GENERATION_COST_JOIN');
  const researchMicroUsd=parseUsdStringToMicroUsd(gateway.cost);
  requireValue(researchMicroUsd===198&&settlement.ceilingRoundedCostMicroUsd===198&&settlement.unresolvedHistoricalReceiptHoldPreserved===true,'RESEARCH_RECEIPT_UNACCOUNTED');
  requireValue(!states.has(research.reservationId)&&!requestOwners.has(research.reservationId),'RESEARCH_DOUBLE_COUNT');
  const required=[hold.reservationId,research.reservationId];
  requireValue(new Set(input.knownLiabilities).size===input.knownLiabilities.length&&required.every(id=>input.knownLiabilities.includes(id))&&input.knownLiabilities.every(id=>required.includes(id)||states.has(id)),'LIABILITY_INVENTORY_MISMATCH');
  let committed=baseline,active=0,uncertain=0;
  for(const r of states.values()){
    const cost=r.status==='settled'?r.actualMicroUsd:r.status==='aborted-before-send'?0:r.reservedMicroUsd;
    committed=sum(committed,cost);
    if(r.status==='active-reserved')active=sum(active,cost);
    if(r.status==='uncertain-locked')uncertain=sum(uncertain,cost);
  }
  const supplement=hold.ceilingMicroUsd-hold.recordedMicroUsd;
  committed=sum(sum(committed,supplement),researchMicroUsd);
  requireValue(committed<=CAP_MICRO_USD,'CAP_EXCEEDED');
  return {committedMicroUsd:committed,activeMicroUsd:active,uncertainMicroUsd:uncertain,ledgerSha256:sha256(bytes),prefixSha256:input.prefix.sha256,researchMicroUsd,supplementMicroUsd:supplement,requestKeys:[...requestOwners.keys()]};
}

export function checkReservation(snapshot:Snapshot,ceiling:number,envelope:number,requestKey:string):void {
  requireValue(integer(ceiling)>0&&integer(envelope)>=ceiling,'UNADMITTED_ENVELOPE');
  requireValue(snapshot.uncertainMicroUsd===0&&snapshot.activeMicroUsd===0,'ACTIVE_OR_UNCERTAIN_REQUEST');
  requireValue(!snapshot.requestKeys.includes(requestKey),'DUPLICATE_REQUEST');
  requireValue(sum(snapshot.committedMicroUsd,ceiling)<=CAP_MICRO_USD,'CAP_EXCEEDED');
}
