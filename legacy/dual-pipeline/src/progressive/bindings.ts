import {isDeepStrictEqual} from 'node:util';
import {assertPublicExposure,type PublicInventory} from './exposure.ts';
import {checkBilling,checkPricing,certificateHash} from './billing.ts';
import {constants} from 'node:fs';
import * as fs from 'node:fs/promises';
import {resolve,dirname,isAbsolute} from 'node:path';
import {sha256,requireValue,integer,reconcileNativeOwner,checkReservation} from './admission.ts';
import {prepareJev,normalizeJev,safeEvidence} from './jev.ts';
import {executeControl as captureControl,canonicalInvocation,type NativeInvocation} from './control.ts';
import {compileOutputSchema} from './schema.ts';
import {RESERVE_MICRO_USD,operationalReserveHash,checkOperationalReserve,checkRootSelection,checkOperationalPricing,externalHold,checkExternalHold,type ReserveBinding} from './operational-reserve.ts';
import {MODEL,ENDPOINT,CAP_MICRO_USD,type Prepared,type LedgerInput,type NativeOwner} from './contracts.ts';

export interface Stat {dev:number;ino:number;isFile:()=>boolean}
export interface Handle {stat:()=>Promise<Stat>;write:(b:Uint8Array)=>Promise<{bytesWritten:number}>;sync:()=>Promise<void>;close:()=>Promise<void>}
export interface Child {stdin:{write:(s:string)=>unknown;end:()=>unknown};stdout:AsyncIterable<Uint8Array>;stderr:AsyncIterable<Uint8Array>;exited:Promise<number>;kill:()=>unknown}
export interface Primitives {
  readFile:(p:string)=>Promise<Uint8Array>;realpath:(p:string)=>Promise<string>;stat:(p:string)=>Promise<Stat>;
  open:(p:string,flags:number,mode?:number)=>Promise<Handle>;syncDirectory:(p:string)=>Promise<void>;
  fetch:(url:string,init:RequestInit)=>Promise<Response>;credential:(path:string)=>Promise<string>;
  spawn:(argv:string[])=>Child;actor:()=>{ownerId:string;threadId:string};
}
export interface Pin {path:string;sha256:string}
interface TrialDispatchBase {
  kind:'root-trial';effect:'jev-http'|'native-cli';taskId:string;owner:NativeOwner;
  requestId:string;requestSha256:string;caseId:string;code:Pin[];evidence:Pin[];verification:Pin;oracleAudit:Pin;
  protocolSha256:string;exposureSha256:string;rubricSha256:string;schema:Pin;publicInventory?:PublicInventory;
  receiptRoot:string;ledgerPath:string;prefix:{bytes:number;sha256:string};
  research:Pin&{reservationId:string;generationId:string;requestBodySha256:string;rawBodySha256:string;request:Pin;requestBody:Pin;settlement:Pin};missingOriginal:LedgerInput['missingOriginal'];
  knownLiabilities:string[];unaccountedLiabilities:string[];
  credentialPath:string;nativeBinary?:Pin;inheritedContext?:Pin[];
}
export type TrialDispatch=TrialDispatchBase&(
 {financialPolicy?:never;pricing:Pin&{allBillableComponentsBounded:boolean;ceilingMicroUsd:number;envelopeMicroUsd:number;certificateSha256?:string;evidence?:Pin[]}}|
 {financialPolicy:ReserveBinding;pricing?:never}
);
type ReserveContext=Pick<TrialDispatchBase,'caseId'|'code'|'evidence'|'verification'|'oracleAudit'|'schema'|'protocolSha256'|'exposureSha256'|'rubricSha256'|'publicInventory'>&{financialPolicy:ReserveBinding};
export interface TrialAuthority {
  /** Exact external Root dispatch bytes. An adoption receipt or flag is not a trial dispatch. */
  dispatchSha256:string;owner:{ownerId:string;threadId:string};taskId:string;
  code:Pin[];verification:Pin;oracleAudit:Pin;receiptRoot:string;ledgerPath:string;credentialPath:string;
}
const hex=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export const ORIGINAL_LEDGER='/LOCAL_HOME/operations/math-problem-editing-20261020/argon-pipeline/budget-ledger.jsonl';
const defaults:Primitives={
  readFile:p=>fs.readFile(p),realpath:p=>fs.realpath(p),stat:p=>fs.stat(p),
  open:async(p,f,m)=>await fs.open(p,f,m) as unknown as Handle,
  syncDirectory:async p=>{const h=await fs.open(p,constants.O_RDONLY);try{await h.sync()}finally{await h.close()}},
  fetch:(url,init)=>globalThis.fetch(url,init),
  credential:async path=>{
    const raw=await fs.readFile(path,'utf8');
    const value=raw.match(/^\s*AI_GATEWAY_API_KEY\s*=\s*([^\r\n]+)\s*$/m)?.[1]?.trim().replace(/^(["'])(.*)\1$/,'$2');
    requireValue(value&&value.length>=8&&!/[\r\n]/.test(value),'CREDENTIAL_UNAVAILABLE');return value;
  },
  spawn:argv=>{const p=Bun.spawn(argv,{stdin:'pipe',stdout:'pipe',stderr:'pipe'});return {stdin:p.stdin,stdout:p.stdout as any,stderr:p.stderr as any,exited:p.exited,kill:()=>p.kill()}},
  actor:()=>({threadId:process.env.CODEX_THREAD_ID??'',ownerId:`native-codex:${process.env.CODEX_THREAD_ID??''}`}),
};

/** Construction is inert. All production operations use these exact functions with real defaults or injected primitives. */
export function createTrialBindings(options:{authority?:TrialAuthority;primitives?:Partial<Primitives>}={}){
  const io:Primitives={...defaults,...options.primitives};const authority=options.authority;
  const consumed=new Set<string>();
  async function pinned(pin:Pin,max=16*1024*1024):Promise<Uint8Array>{
    requireValue(pin&&isAbsolute(pin.path)&&hex(pin.sha256)&&await io.realpath(pin.path)===pin.path,'PIN_PATH_OR_SYMLINK');
    requireValue((await io.stat(pin.path)).isFile(),'PIN_NOT_REGULAR');
    const b=await io.readFile(pin.path);requireValue(b.length<=max&&sha256(b)===pin.sha256,'PIN_BYTES_CHANGED');return b;
  }
  function admit(raw:string|undefined,effect:TrialDispatch['effect'],requestSha256:string):TrialDispatch {
    requireValue(authority&&typeof raw==='string'&&raw.length<=65536,'ROOT_TRIAL_REQUIRED');
    requireValue(hex(authority.dispatchSha256)&&sha256(raw)===authority.dispatchSha256,'TRIAL_DISPATCH_HASH');
    const d=JSON.parse(raw) as TrialDispatch;
    requireValue(!Object.hasOwn(d,'financialPolicy')||d.financialPolicy?.kind==='operational-reserve-v1'&&!Object.hasOwn(d,'pricing')&&effect==='jev-http','TRIAL_FINANCIAL_POLICY_KIND');
    requireValue(d.kind==='root-trial'&&d.effect===effect&&d.taskId===authority.taskId&&same(d.code,authority.code)&&same(d.verification,authority.verification)&&d.oracleAudit&&same(d.oracleAudit,authority.oracleAudit),'TRIAL_BINDING_MISMATCH');
    requireValue(d.owner&&d.owner.ownerId===authority.owner.ownerId&&d.owner.threadId===authority.owner.threadId&&d.owner.taskId===d.taskId&&d.owner.activePaidRequests===1&&!['math-argon-lead','math-gpt-lead'].includes(d.owner.ownerId),'CURRENT_NATIVE_OWNER_REQUIRED');
    requireValue(d.requestSha256===requestSha256&&d.owner.requestSha256===requestSha256&&d.owner.sourceSha256===sha256(JSON.stringify(d.code))&&hex(d.owner.dispatchSha256)&&hex(d.protocolSha256)&&hex(d.exposureSha256)&&hex(d.rubricSha256),'TRIAL_REQUEST_PINS');
    requireValue(d.ledgerPath===ORIGINAL_LEDGER&&d.ledgerPath===authority.ledgerPath&&d.credentialPath===authority.credentialPath&&d.receiptRoot===authority.receiptRoot&&isAbsolute(d.ledgerPath)&&isAbsolute(d.receiptRoot)&&isAbsolute(d.credentialPath),'TRIAL_PATH_BINDING');
    requireValue(/^local_[A-Za-z0-9-]{8,}$/.test(d.requestId)&&!consumed.has(d.requestId),'DUPLICATE_TRIAL');
    requireValue(d.code.length>0&&d.evidence.length>0&&d.evidence.length<=32&&hex(d.schema?.sha256),'TRIAL_INPUT_INVENTORY');
    const actor=io.actor();requireValue(same(actor,authority.owner),'NATIVE_ACTOR_MISMATCH');
    return d;
  }
  async function inputs(d:TrialDispatch){
    requireValue(await io.realpath(d.receiptRoot)===d.receiptRoot,'RECEIPT_ROOT_SYMLINK');
    for(const p of [...d.code,d.verification,d.oracleAudit,...d.evidence])await pinned(p);
    assertPublicExposure(d.caseId,d.evidence,d.publicInventory);
    try{assertPublicExposure(d.caseId,[{...d.schema,role:'schema'}],d.publicInventory)}catch{throw Error('OUTPUT_SCHEMA_PUBLIC_INVENTORY')}
    return compileOutputSchema(JSON.parse(new TextDecoder().decode(await pinned(d.schema,65536))));
  }
  async function validateReserve(d:ReserveContext,prepared:Prepared){
    const p=prepared.input.operationalReserve, f=d.financialPolicy;
    requireValue(f&&Object.keys(f).sort().join(',')==='kind,policy,reservationMicroUsd,rootSelection','RESERVE_BINDING_FIELDS');
    requireValue(p&&prepared.reservationPolicy?.kind==='operational-reserve-v1'&&prepared.liabilityCeilingMicroUsd===null&&prepared.billingCertificateSha256===null,'RESERVE_PREPARED_POLICY');
    requireValue(f?.kind==='operational-reserve-v1'&&f.reservationMicroUsd===RESERVE_MICRO_USD&&same(f.rootSelection,p.rootSelection)&&f.policy.sha256===operationalReserveHash(p)&&prepared.reservationPolicy.policySha256===f.policy.sha256,'RESERVE_DISPATCH_POLICY');
    const policyBytes=await pinned(f.policy,65536);
    requireValue(same(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(policyBytes)),p),'RESERVE_POLICY_BYTES');
    checkRootSelection(p,await pinned(f.rootSelection,65536));
    requireValue(d.caseId===p.caseId&&d.protocolSha256===p.pins.protocol&&d.exposureSha256===p.pins.exposure&&d.rubricSha256===p.pins.rubric&&same(d.schema,p.outputSchema)&&prepared.outputSchemaSha256===d.schema.sha256,'RESERVE_CASE_LINEAGE');
    requireValue(d.evidence.length===2&&[p.packet,p.request].every(e=>d.evidence.some(x=>same(e,x))),'RESERVE_PUBLIC_EVIDENCE');
    assertPublicExposure(d.caseId,d.evidence,d.publicInventory);assertPublicExposure(d.caseId,[{...d.schema,role:'schema'}],d.publicInventory);
    for(const value of [...d.code,...d.evidence,d.schema,d.oracleAudit,p.requestAdapter])await pinned(value);
    checkOperationalPricing(p,await pinned(p.pricing));
    const review=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await pinned(d.verification,65536)));
    requireValue(review.schema==='jev.independent-operational-reserve-review.v1'&&review.qualification==='exact-request-and-policy'&&review.policySha256===f.policy.sha256&&review.bodySha256===prepared.bodySha256&&same(review.code,d.code)&&same(review.rootSelection,f.rootSelection)&&same(review.outputSchema,d.schema)&&same(review.requestAdapter,p.requestAdapter)&&same(review.publicPacket,p.packet)&&same(review.publicRequest,p.request),'INDEPENDENT_RESERVE_REVIEW_REQUIRED');
    checkOperationalReserve(p,prepared.input,prepared.bodyJson,prepared.headers);
  }
  async function readLedger(d:TrialDispatch):Promise<{input:LedgerInput;identity:Stat}>{
    requireValue(await io.realpath(d.ledgerPath)===d.ledgerPath,'LEDGER_SYMLINK');
    const identity=await io.stat(d.ledgerPath);requireValue(identity.isFile(),'LEDGER_NOT_REGULAR');
    const bytes=await io.readFile(d.ledgerPath);requireValue(bytes.length<=16*1024*1024,'LEDGER_SIZE_BOUND');
    const tail=new TextDecoder().decode(bytes.subarray(d.prefix.bytes));
    if(tail)for(const line of tail.trimEnd().split('\n'))requireValue(JSON.parse(line).schema==='jev.progressive.budget-event.v1','UNOWNED_LEDGER_TAIL');
    const response=await pinned(d.research,65536);
    const input:LedgerInput={bytes,prefix:d.prefix,research:{response,sha256:d.research.sha256,reservationId:d.research.reservationId,generationId:d.research.generationId,requestBodySha256:d.research.requestBodySha256,rawBodySha256:d.research.rawBodySha256,responsePath:d.research.path,request:{bytes:await pinned(d.research.request,65536),sha256:d.research.request.sha256},requestBody:{bytes:await pinned(d.research.requestBody,65536),sha256:d.research.requestBody.sha256},settlement:{bytes:await pinned(d.research.settlement,65536),sha256:d.research.settlement.sha256}},missingOriginal:d.missingOriginal,knownLiabilities:d.knownLiabilities,unaccountedLiabilities:d.unaccountedLiabilities};
    reconcileNativeOwner(input);
    const reservations=new Map<string,any>(),requestIntents=new Map<string,any>();
    if(tail)for(const line of tail.trimEnd().split('\n')){
      const row=JSON.parse(line),receipt=JSON.parse(new TextDecoder().decode(await pinned({path:row.receiptPath,sha256:row.receiptSha256},262145)));
      const l=receipt.lineage;
      requireValue(l&&l.requestId===row.requestKey&&l.requestSha256===row.nativeOwner.requestSha256&&l.bodySha256===row.nativeOwner.requestSha256&&l.caseId===row.unitId&&l.sourceSha256===row.nativeOwner.sourceSha256&&isDeepStrictEqual(l.owner,row.nativeOwner),'RECEIPT_REQUEST_LINEAGE');
      const operational=Object.hasOwn(l,'financialPolicy');
      requireValue(sha256(JSON.stringify(l.code))===l.sourceSha256&&hex(l.schema?.sha256)&&hex(l.protocolSha256)&&hex(l.exposureSha256)&&hex(l.rubricSha256),'RECEIPT_SOURCE_LINEAGE');
      if(operational)requireValue(l.financialPolicy?.kind==='operational-reserve-v1'&&!Object.hasOwn(l,'pricing')&&!Object.hasOwn(l,'billingCertificateSha256')&&row.reservedMicroUsd===RESERVE_MICRO_USD&&row.actualMicroUsd===null&&row.eventKind!=='reservation-settled-actual','REPLAY_RESERVE_VARIANT');
      else requireValue(hex(l.pricing?.sha256)&&hex(l.billingCertificateSha256),'RECEIPT_SOURCE_LINEAGE');
      if(row.eventKind==='reservation-created'){
        requireValue(receipt.kind==='trial-request'&&receipt.bodySha256===l.bodySha256&&sha256(JSON.stringify(receipt.body))===l.bodySha256,'RESERVATION_RECEIPT_JOIN');
        if(operational){
          const rebuilt=prepareJev(receipt.stageInput);
          requireValue(rebuilt.disposition==='prepared'&&rebuilt.bodySha256===l.bodySha256&&same(JSON.parse(rebuilt.bodyJson),receipt.body)&&same(rebuilt.headers,receipt.headers)&&!Object.hasOwn(receipt,'billing')&&receipt.mode===rebuilt.input.mode&&receipt.reservedMicroUsd===RESERVE_MICRO_USD,'REPLAY_RESERVE_REQUEST');
          await validateReserve(l,rebuilt);
        }else{
        const reviewed=JSON.parse(new TextDecoder().decode(await pinned(l.verification)));
        requireValue(reviewed.schema==='jev.independent-transport-review.v1'&&reviewed.billingCertificateSha256s?.includes(l.billingCertificateSha256),'REPLAY_BILLING_REVIEW');
        requireValue(certificateHash(receipt.billing)===l.billingCertificateSha256&&receipt.billing.pricingSha256===l.pricing.sha256&&receipt.billing.outputSchemaSha256===l.schema.sha256,'REPLAY_PRICING_SCHEMA_JOIN');
        requireValue(checkBilling(receipt.billing,{mode:receipt.mode,questions:receipt.body.questions},JSON.stringify(receipt.body),receipt.headers)===row.reservedMicroUsd,'REPLAY_BILLING_CEILING');
        checkPricing(receipt.billing,await pinned(l.pricing));
        requireValue(Array.isArray(l.pricing.evidence)&&l.pricing.evidence.length===receipt.billing.officialEvidence.length,'REPLAY_BILLING_EVIDENCE');
        for(const e of receipt.billing.officialEvidence){const p=l.pricing.evidence.find((p:Pin)=>p.sha256===e.sha256);requireValue(p,'REPLAY_BILLING_EVIDENCE_PIN');await pinned(p)}
        }
        for(const p of l.code)await pinned(p);
        await pinned(l.schema);reservations.set(row.requestKey,l);requestIntents.set(row.requestKey,receipt);
      }else{
        requireValue(receipt.requestId===row.requestKey&&receipt.requestSha256===l.requestSha256&&isDeepStrictEqual(l,reservations.get(row.requestKey)),'TERMINAL_RECEIPT_JOIN');
        if(row.eventKind==='reservation-settled-actual'||operational&&receipt.kind==='trial-response-external-hold'){
          const occurrence=operational?receipt.providerOccurrence:row.generationId;
          if(operational){
            requireValue(row.eventKind==='reservation-locked-uncertain'&&row.status==='uncertain-locked'&&row.actualMicroUsd===null&&receipt.result?.actualMicroUsd!==null,'REPLAY_RESERVE_RETAINED');
            checkExternalHold(receipt.financial,receipt.result?.actualMicroUsd);
          }
          requireValue(receipt.kind===(operational?'trial-response-external-hold':'trial-response')&&(operational||receipt.result?.actualMicroUsd===row.actualMicroUsd)&&receipt.result?.provenance?.complete===true&&receipt.result?.providerGenerationId===occurrence&&receipt.providerOccurrence===occurrence,'SETTLEMENT_RECEIPT_COST_OR_PROVIDER');
          requireValue(receipt.observedResponse?.path===resolve(dirname(row.receiptPath),`${row.requestKey}.observed-response.json`),'OBSERVED_RESPONSE_PIN');
          const observed=JSON.parse(new TextDecoder().decode(await pinned(receipt.observedResponse,262145)));
          requireValue(observed.kind==='observed-unsettled-response'&&observed.settlementVerified===false&&observed.status===200&&observed.status===receipt.response?.status,'OBSERVED_RESPONSE_KIND_OR_STATUS');
          requireValue(observed.requestId===row.requestKey&&observed.requestSha256===l.requestSha256&&isDeepStrictEqual(observed.lineage,l),'OBSERVED_RESPONSE_REQUEST_LINEAGE');
          requireValue(hex(receipt.rawResponseSha256)&&observed.rawResponseSha256===receipt.rawResponseSha256,'OBSERVED_RESPONSE_RAW_DIGEST');
          requireValue(hex(observed.redactedBodySha256)&&sha256(JSON.stringify(observed.redactedBody))===observed.redactedBodySha256&&observed.redactedBodySha256===receipt.redactedBodySha256&&isDeepStrictEqual(observed.redactedBody,receipt.response?.body),'OBSERVED_RESPONSE_REDACTED_BODY');
          requireValue(observed.providerOccurrence===receipt.providerOccurrence,'OBSERVED_RESPONSE_PROVIDER');
          requireValue(receipt.response?.status===200&&receipt.response?.body?.provider_metadata?.gateway?.generationId===occurrence&&sha256(JSON.stringify(receipt.response.body))===receipt.redactedBodySha256,'RESPONSE_BODY_PROVENANCE_JOIN');
          const intent=requestIntents.get(row.requestKey),prepared=prepareJev(intent.stageInput);
          requireValue(prepared.disposition==='prepared'&&prepared.bodySha256===l.bodySha256,'REPLAY_PREPARED_BODY');
          const normalized=normalizeJev(receipt.response.body,prepared);
          if(operational)requireValue(normalized.inputTokens!==null&&normalized.outputTokens!==null&&normalized.actualMicroUsd!==null&&normalized.actualMicroUsd<=RESERVE_MICRO_USD,'REPLAY_RESERVE_USAGE_COST');
          requireValue(isDeepStrictEqual(normalized,receipt.result),'REPLAY_NORMALIZED_RESPONSE');
          compileOutputSchema(JSON.parse(new TextDecoder().decode(await pinned(l.schema))))(normalized.answers);
          requireValue(receipt.response.body.model===MODEL&&receipt.response.body.provider_metadata.gateway.routing.canonicalSlug===MODEL&&receipt.response.body.provider_metadata.gateway.routing.finalProvider==='typesafe-ai'&&receipt.response.body.provider_metadata.gateway.cost===receipt.result.costUsd,'RESPONSE_MODEL_COST_JOIN');
        }else requireValue(receipt.kind==='trial-failure'&&receipt.reservationRetained===true,'UNCERTAIN_RECEIPT_JOIN');
      }
    }
    return {input,identity};
  }
  async function exclusive(path:string,value:unknown,secrets:readonly string[]=[]){
    const text=safeEvidence(value,secrets,262144)+'\n';JSON.parse(text);const b=new TextEncoder().encode(text);
    requireValue(await io.realpath(dirname(path))===dirname(path),'RECEIPT_PARENT_SYMLINK');
    const h=await io.open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{requireValue((await h.write(b)).bytesWritten===b.length,'PARTIAL_RECEIPT_WRITE');await h.sync()}finally{await h.close()}
    await io.syncDirectory(dirname(path));
    requireValue(sha256(await io.readFile(path))===sha256(b),'RECEIPT_READBACK_FAILED');
    return {path,sha256:sha256(b)};
  }
  const receiptPath=(d:TrialDispatch,name:string)=>resolve(d.receiptRoot,`${d.requestId}.${name}.json`);
  async function claim(d:TrialDispatch){
    // Exclusive claim survives process restart; no OS-lock or multi-writer guarantee is claimed.
    await exclusive(receiptPath(d,'claim'),{kind:'trial-claim',requestId:d.requestId,requestSha256:d.requestSha256,externalDispatchSha256:authority!.dispatchSha256,effect:d.effect});consumed.add(d.requestId);
  }
  function lineage(d:TrialDispatch){return {requestId:d.requestId,requestSha256:d.requestSha256,bodySha256:d.requestSha256,caseId:d.caseId,owner:d.owner,sourceSha256:d.owner.sourceSha256,code:d.code,verification:d.verification,schema:d.schema,...(d.financialPolicy?{financialPolicy:d.financialPolicy,evidence:d.evidence,oracleAudit:d.oracleAudit,publicInventory:d.publicInventory}:{pricing:{path:d.pricing!.path,sha256:d.pricing!.sha256,evidence:d.pricing!.evidence},billingCertificateSha256:d.pricing!.certificateSha256}),protocolSha256:d.protocolSha256,exposureSha256:d.exposureSha256,rubricSha256:d.rubricSha256,publicInventorySha256:d.publicInventory?.manifestSha256??null}}
  async function append(d:TrialDispatch,event:'reservation-created'|'reservation-settled-actual'|'reservation-locked-uncertain',amount:number,actual:number|null,receipt:Pin){
    const before=await readLedger(d),snapshot=reconcileNativeOwner(before.input);
    const bytes=before.input.bytes!;
    const previous=event==='reservation-created'?0:amount;
    const effective=event==='reservation-settled-actual'?integer(actual):amount;
    const ledgerTotal=snapshot.committedMicroUsd-snapshot.supplementMicroUsd-snapshot.researchMicroUsd-previous+effective;
    const row={schema:'jev.progressive.budget-event.v1',timestamp:new Date().toISOString(),eventKind:event,reservationId:d.requestId,requestKey:d.requestId,callerOwner:d.owner.ownerId,nativeOwner:d.owner,routeId:'systemone-jev-1.14',modelId:MODEL,unitId:d.caseId,reservedMicroUsd:amount,actualMicroUsd:actual,effectiveCommittedMicroUsd:effective,cumulativeCommittedMicroUsd:ledgerTotal,remainingBudgetMicroUsd:CAP_MICRO_USD-ledgerTotal,sessionCapMicroUsd:CAP_MICRO_USD,status:event==='reservation-created'?'active-reserved':event==='reservation-settled-actual'?'settled':'uncertain-locked',generationId:event==='reservation-settled-actual'?JSON.parse(new TextDecoder().decode(await pinned(receipt))).providerOccurrence:null,receiptPath:receipt.path,receiptSha256:receipt.sha256,notes:'Current native-owned occurrence; Root serialized writer'};
    const data=new TextEncoder().encode(JSON.stringify(row)+'\n');
    // Validate the exact next row with the same replay used at future admission.
    const combined=Buffer.concat([bytes,data]);reconcileNativeOwner({...before.input,bytes:combined});
    const h=await io.open(d.ledgerPath,constants.O_WRONLY|constants.O_APPEND|constants.O_NOFOLLOW);
    try{
      const current=await h.stat();requireValue(current.dev===before.identity.dev&&current.ino===before.identity.ino,'LEDGER_DESCRIPTOR_CHANGED');
      requireValue(sha256(await io.readFile(d.ledgerPath))===sha256(bytes),'LEDGER_CHANGED_BEFORE_APPEND');
      requireValue((await h.write(data)).bytesWritten===data.length,'PARTIAL_LEDGER_WRITE');await h.sync();
    }finally{await h.close()}
    const after=await io.readFile(d.ledgerPath);requireValue(sha256(after)===sha256(combined),'LEDGER_APPEND_READBACK_FAILED');
    return row;
  }
  async function executeJev(prepared:Prepared,rawDispatch?:string){
    const d=admit(rawDispatch,'jev-http',prepared.bodySha256);
    const rebuilt=prepareJev(prepared.input);
    requireValue(rebuilt.disposition==='prepared'&&same(rebuilt,prepared),'PREPARED_REQUEST_MUTATED');
    requireValue(d.caseId===prepared.input.caseId&&d.protocolSha256===prepared.input.pins.protocol&&d.exposureSha256===prepared.input.pins.exposure&&d.rubricSha256===prepared.input.pins.rubric,'CASE_PINS_CHANGED');
    requireValue(!['box','presence'].includes(prepared.input.mode),'EXPERIMENTAL_IMAGE_MODE_HELD');
    const validateOutput=await inputs(d);
    const operational=!!prepared.input.operationalReserve;
    requireValue(operational===Object.hasOwn(d,'financialPolicy'),'PREPARED_DISPATCH_POLICY_MISMATCH');
    if(operational){await validateReserve(d as ReserveContext,prepared)}else{
    const pricing=d.pricing;requireValue(pricing,'STRICT_PRICING_REQUIRED');
    const pricingBytes=await pinned(pricing);
    requireValue(prepared.input.billing&&prepared.billingCertificateSha256===certificateHash(prepared.input.billing)&&pricing.certificateSha256===prepared.billingCertificateSha256&&pricing.sha256===prepared.pricingSha256&&d.schema.sha256===prepared.outputSchemaSha256,'PREPARED_PRICING_SCHEMA_LINEAGE');
    checkPricing(prepared.input.billing,pricingBytes);
    requireValue(Array.isArray(pricing.evidence)&&pricing.evidence.length===prepared.input.billing.officialEvidence.length,'BILLING_EVIDENCE_PIN_INVENTORY');
    for(const e of prepared.input.billing.officialEvidence){const p=pricing.evidence.find(p=>p.sha256===e.sha256);requireValue(p,'BILLING_EVIDENCE_PIN');await pinned(p)}
    const review=JSON.parse(new TextDecoder().decode(await pinned(d.verification)));
    requireValue(review.schema==='jev.independent-transport-review.v1'&&review.billingCertificateSha256s?.includes(prepared.billingCertificateSha256),'INDEPENDENT_BILLING_REVIEW_REQUIRED');
    requireValue(checkBilling(prepared.input.billing,prepared.input,prepared.bodyJson,prepared.headers)===prepared.liabilityCeilingMicroUsd,'SEMANTIC_BILLING_BOUND');
    requireValue(pricing.allBillableComponentsBounded===true&&pricing.ceilingMicroUsd===prepared.liabilityCeilingMicroUsd,'UNSUPPORTED_BILLABLE_BOUND');
    requireValue(prepared.liabilityCeilingMicroUsd!==null&&prepared.liabilityCeilingMicroUsd>0,'UNCERTIFIED_LIABILITY_HELD');
    }
    const amount=operational?RESERVE_MICRO_USD:prepared.liabilityCeilingMicroUsd!;
    const before=await readLedger(d),snapshot=reconcileNativeOwner(before.input);
    if(operational)requireValue(snapshot.committedMicroUsd>=23826,'INHERITED_LIABILITY_FLOOR');
    checkReservation(snapshot,amount,operational?RESERVE_MICRO_USD:d.pricing!.envelopeMicroUsd,d.requestId);
    await claim(d);
    const intent=await exclusive(receiptPath(d,'request'),{kind:'trial-request',lineage:lineage(d),model:MODEL,endpoint:ENDPOINT,mode:prepared.input.mode,stageInput:prepared.input,headers:prepared.headers,billing:prepared.input.billing,body:JSON.parse(prepared.bodyJson),bodySha256:prepared.bodySha256,sourceSha256:d.owner.sourceSha256,reservedMicroUsd:amount});
    await append(d,'reservation-created',amount,null,intent);
    let sent=0,observedActual:number|null=null;const secrets:string[]=[];
    try{
      // Reconcile after the durable reservation, then load the credential only at the admitted send boundary.
      const current=reconcileNativeOwner((await readLedger(d)).input);
      requireValue(current.uncertainMicroUsd===0&&current.activeMicroUsd===amount,'RESERVATION_STATE_CHANGED');
      requireValue(await io.realpath(d.credentialPath)===d.credentialPath,'CREDENTIAL_PATH_SYMLINK');
      const key=await io.credential(d.credentialPath);requireValue(key.length>=8&&!/[\r\n]/.test(key),'CREDENTIAL_UNAVAILABLE');secrets.push(key);
      sent=1;
      const response=await io.fetch(ENDPOINT,{method:'POST',body:prepared.bodyJson,headers:{...prepared.headers,Authorization:`Bearer ${key}`},redirect:'manual'});
      requireValue(response.status===200,'HTTP_RESPONSE_HELD');
      requireValue(!response.headers.get('x-ai-gateway-decision-fallback-triggered')&&!response.headers.get('x-ai-gateway-evaluation-fallback-triggered'),'UNEXPECTED_FALLBACK');
      const body=await readResponse(response,prepared.maxResponseBytes);
      const raw=JSON.parse(body);
      const observationBody=JSON.parse(safeEvidence(raw,secrets,131072));
      const observationHeaders=Object.fromEntries([...response.headers].filter(([k])=>/^(?:x-vercel-id|x-request-id|x-ai-gateway-|content-type)/i.test(k)));
      const observedResponse=await exclusive(receiptPath(d,'observed-response'),{kind:'observed-unsettled-response',lineage:lineage(d),requestId:d.requestId,requestSha256:d.requestSha256,status:response.status,headers:observationHeaders,redactedBody:observationBody,rawResponseSha256:sha256(body),redactedBodySha256:sha256(JSON.stringify(observationBody)),providerOccurrence:typeof raw.provider_metadata?.gateway?.generationId==='string'?raw.provider_metadata.gateway.generationId:null,settlementVerified:false},secrets);
      const result=normalizeJev(raw,prepared);validateOutput(result.answers);
      observedActual=result.actualMicroUsd;
      requireValue(result.provenance.complete,'MISSING_PROVIDER_ATTESTATION');
      requireValue(result.actualMicroUsd!==null&&result.inputTokens!==null&&result.outputTokens!==null&&result.actualMicroUsd<=amount,'MISSING_OR_EXCESS_COST_USAGE');
      const redactedBody=JSON.parse(safeEvidence(raw,secrets,131072));
      const exposedHeaders=Object.fromEntries([...response.headers].filter(([k])=>/^(?:x-vercel-id|x-request-id|x-ai-gateway-|content-type)/i.test(k)));
      const financial=operational?externalHold(result.actualMicroUsd):undefined;
      const receipt=await exclusive(receiptPath(d,'response'),{kind:operational?'trial-response-external-hold':'trial-response',lineage:lineage(d),requestId:d.requestId,requestSha256:d.requestSha256,observedResponse,providerOccurrence:result.providerGenerationId,response:{status:response.status,headers:exposedHeaders,body:redactedBody},redactedBodySha256:sha256(JSON.stringify(redactedBody)),rawResponseSha256:sha256(body),redaction:'persisted evidence is redacted; raw hash is provenance, not a saved unredacted receipt',result,providerAttempts:result.provenance.providerAttempts,...(operational?{financial}:{} )},secrets);
      await append(d,operational?'reservation-locked-uncertain':'reservation-settled-actual',amount,operational?null:result.actualMicroUsd,receipt);
      return JSON.parse(safeEvidence({disposition:'captured',requestId:d.requestId,bodySha256:prepared.bodySha256,outputSha256:sha256(JSON.stringify(result.answers)),result,receipt,httpRequestsSent:sent,providerAttempts:result.provenance.providerAttempts,heldMicroUsd:operational?amount:0,...(operational?{financial}:{}),nativeCLIInvocationProxy:0,sharedOrchestrationOverhead:null,acceptanceDecision:null},secrets,262144));
    }catch{
      // Do not persist raw exception text. A persistence failure may leave an active or uncertain reserve.
      const breach=operational&&observedActual!==null&&observedActual>amount;
      const reason=breach?'OBSERVED_RESERVE_BREACH':'BOUNDARY_UNCERTAIN_OR_RESPONSE_INVALID';
      try{const failure=await exclusive(receiptPath(d,'failure'),{kind:'trial-failure',lineage:lineage(d),requestId:d.requestId,requestSha256:d.requestSha256,reason,httpRequestsSent:sent,reservationRetained:true,...(operational?{reportedGenerationMicroUsd:observedActual}: {})});await append(d,'reservation-locked-uncertain',amount,null,failure)}catch{/* Original reservation remains; reconciliation required, never resend. */}
      return {disposition:'held',reason,requestId:d.requestId,httpRequestsSent:sent,providerAttempts:null,heldMicroUsd:amount,...(operational?{reportedGenerationMicroUsd:observedActual}:{}),nativeCLIInvocationProxy:0,acceptanceDecision:null};
    }
  }
  async function executeControl(inv:NativeInvocation,rawDispatch?:string){
    const d=admit(rawDispatch,'native-cli',inv.contentSha256);
    requireValue(sha256(JSON.stringify({argv:inv.argv,stdin:inv.stdin,packet:inv.packet}))===inv.contentSha256,'NATIVE_PACKET_MUTATED');
    if(!canonicalInvocation(inv))return {disposition:'held',reason:'NONCANONICAL_NATIVE_ARGV',nativeCLIInvocationProxy:0,providerAttempts:null,acceptanceDecision:null};
    requireValue(isDeepStrictEqual(d.publicInventory,inv.packet.inventory),'NATIVE_PUBLIC_INVENTORY_BINDING');
    requireValue(d.caseId===inv.packet.caseId&&d.schema.path===inv.packet.schemaPath&&same(d.evidence,inv.packet.exposure.map(x=>({path:x.path,sha256:x.sha256}))),'NATIVE_PACKET_BINDING');
    requireValue(d.nativeBinary?.path===inv.argv[0]&&hex(d.nativeBinary?.sha256),'NATIVE_BINARY_PIN');
    const validateOutput=await inputs(d);await pinned(d.nativeBinary!,128*1024*1024);
    requireValue(d.inheritedContext&&d.inheritedContext.length>0,'NATIVE_INHERITED_CONTEXT_UNDECLARED');
    for(const pin of d.inheritedContext)await pinned(pin);
    requireValue(await io.realpath(inv.packet.directory)===inv.packet.directory&&dirname(inv.packet.outputPath)===d.receiptRoot,'NATIVE_OUTPUT_ROOT');
    try{await io.stat(inv.packet.outputPath);throw Error('NATIVE_OUTPUT_ALREADY_EXISTS')}catch(e){requireValue((e as any)?.code==='ENOENT','NATIVE_OUTPUT_ALREADY_EXISTS')}
    await claim(d);
    await exclusive(receiptPath(d,'native-request'),{argv:inv.argv,stdinSha256:sha256(inv.stdin),exposure:inv.packet.exposure,schema:d.schema,inheritedContext:d.inheritedContext});
    let invocations=0;
    const captured=await captureControl(inv,{kind:'injected-low-level-spawn',run:async(inv,onLine)=>{
      // Validate schema and immutable invocation before the actual process primitive.
      const child=io.spawn(inv.argv);invocations++;
      try{
        await child.stdin.write(inv.stdin);await child.stdin.end();
        let total=0,pending='';
        const decoder=new TextDecoder('utf-8',{fatal:true});
        const decode=(part?:Uint8Array)=>{try{return part===undefined?decoder.decode():decoder.decode(part,{stream:true})}catch{throw Error('NATIVE_INVALID_UTF8')}};
        const out=(async()=>{for await(const part of child.stdout){total+=part.byteLength;requireValue(total<=inv.maxTotalBytes,'NATIVE_OUTPUT_BOUND');pending+=decode(part);requireValue(Buffer.byteLength(pending)<=inv.maxEventBytes||pending.includes('\n'),'NATIVE_EVENT_BOUND');let at;while((at=pending.indexOf('\n'))>=0){const line=pending.slice(0,at);pending=pending.slice(at+1);if(line)onLine(line)}}pending+=decode();if(pending.trim())onLine(pending)})();
        const err=(async()=>{let bytes=0;for await(const part of child.stderr){bytes+=part.byteLength;requireValue(bytes<=65536,'NATIVE_STDERR_BOUND')}})();
        const [exitCode]=await Promise.all([child.exited,out,err]);
        requireValue(exitCode===0,'NATIVE_EXIT_NONZERO');
        const b=await io.readFile(inv.packet.outputPath);requireValue(b.length<=65536,'NATIVE_MESSAGE_BOUND');
        const lastMessage=new TextDecoder().decode(b);validateOutput(JSON.parse(lastMessage));
        return {exitCode,lastMessage};
      }catch(e){child.kill();throw e}
    }});
    const {events,observedReads,...measurement}=captured;
    const eventEvidence=events.slice(0,256).map((e:unknown)=>({sha256:sha256(JSON.stringify(e))}));
    const safe=JSON.parse(safeEvidence({...measurement,eventCount:events.length,allEventsSha256:sha256(JSON.stringify(events)),eventEvidence,eventPreviewTruncated:events.length>256,eventsPreview:events.slice(0,16).map((e:unknown)=>safeEvidence(e,[],512)),observedReads:observedReads.slice(0,64),observedReadsSha256:sha256(JSON.stringify(observedReads)),nativeCLIInvocationProxy:invocations,providerAttempts:null,sharedOrchestrationOverhead:null,caseId:d.caseId},[],262144));
    const receipt=await exclusive(receiptPath(d,'native-result'),safe);
    return {...safe,receipt};
  }
  return {executeJev,executeControl};
}
async function readResponse(response:Response,max:number):Promise<string>{
  const reader=response.body?.getReader();if(!reader)return '';
  let total=0;const chunks:Uint8Array[]=[];
  try{for(;;){const p=await reader.read();if(p.done)break;total+=p.value.length;if(total>max){await reader.cancel();throw Error('RESPONSE_BYTES_BOUND')}chunks.push(p.value)}}finally{reader.releaseLock()}
  return Buffer.concat(chunks).toString('utf8');
}
