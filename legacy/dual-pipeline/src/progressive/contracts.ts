import type {BillingCertificate} from './billing.ts';
import type {OperationalReservePolicy} from './operational-reserve.ts';
export const MODEL = 'typesafe-ai/jev-1.14.0' as const;
export const ENDPOINT = 'https://ai-gateway.vercel.sh/typesafe/v1/systemone' as const;
export const CAP_MICRO_USD = 10_000_000;
export type Mode = 'text' | 'research' | 'routing' | 'box' | 'presence';
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export type Question = {type:'choice';instructions:string;criteria:Record<string,string>} | {type:'noul'|'box';instructions:string};
interface StageInputBase {
  caseId:string; stageId:string; mode:Mode; state:Json; questions:Record<string,Question>;
  image?:Uint8Array; imageReference?:string;
  pins:{source:string;protocol:string;exposure:string;rubric:string;evaluator:string};
  parentOutputSha256?:string;
}
export type StageInput=StageInputBase&(
 {billing?:BillingCertificate;operationalReserve?:never}|
 {billing?:never;operationalReserve:OperationalReservePolicy}
);
export interface Held { disposition:'held'; reason:string }
interface PreparedBase {
  disposition:'prepared'; input:StageInput; endpoint:typeof ENDPOINT; model:typeof MODEL;
  bodyJson:string; bodySha256:string; headers:Record<string,string>;
  maxBodyBytes:number; maxResponseBytes:number; maxInputTokens:number; maxOutputBytes:number;
  liabilityCeilingMicroUsd:number|null; pricingSha256:string;
  billingCertificateSha256:string|null; outputSchemaSha256:string|null;
  liveHold:string; // Never admission; all image modes remain unverified.
}
export type Prepared=PreparedBase&(
 {reservationPolicy?:never}|
 {reservationPolicy:{kind:'operational-reserve-v1';policySha256:string;reservationMicroUsd:250000};liabilityCeilingMicroUsd:null;billingCertificateSha256:null}
);
export interface NativeOwner {
  ownerId:string; threadId:string; taskId:string; dispatchSha256:string;
  sourceSha256:string; requestSha256:string; activePaidRequests:1;
}
export interface LedgerInput {
  bytes:Uint8Array|null; prefix:{bytes:number;sha256:string};
  research:{response:Uint8Array;sha256:string;reservationId:string;generationId:string;requestBodySha256:string;rawBodySha256:string;request:{bytes:Uint8Array;sha256:string};requestBody:{bytes:Uint8Array;sha256:string};responsePath:string;settlement:{bytes:Uint8Array;sha256:string}}|null;
  missingOriginal:{reservationId:string;recordedMicroUsd:number;ceilingMicroUsd:number};
  knownLiabilities: readonly string[]; unaccountedLiabilities:readonly string[];
}
export interface Snapshot {
  committedMicroUsd:number; activeMicroUsd:number; uncertainMicroUsd:number;
  ledgerSha256:string; prefixSha256:string; researchMicroUsd:number;
  supplementMicroUsd:number; requestKeys:readonly string[];
}
export interface TypedResult {
  answers:Record<string,Json>; returnedModel:string|null;
  providerGenerationId:string|null; inputTokens:number|null; outputTokens:number|null;
  costUsd:string|null; actualMicroUsd:number|null;
  provenance:{requestedModel:string;returnedModelEcho:string|null;servingModel:string|null;provider:string|null;generationId:string|null;providerAttempts:number|null;complete:boolean;locations:string[]};
  interpretationAccepted:false; confidenceAccuracyVerified:false;
}
