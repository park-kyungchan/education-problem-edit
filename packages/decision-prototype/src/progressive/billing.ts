import {sha256,requireValue,integer} from './admission.ts';
import {MODEL,ENDPOINT} from './contracts.ts';
export interface BillingCertificate {
 schema:'jev.reviewed-billing-bound.v1';model:typeof MODEL;endpoint:typeof ENDPOINT;mode:'text'|'research'|'routing';
 pricingSha256:string;outputSchemaSha256:string;officialEvidence:{url:string;sha256:string}[];
 boundMethod:'reviewed-context-rejection';maxInputTokens:number;maxQuestions:number;maxBodyBytes:number;
 maxRequestWindow:number;maxQuestionWindow:number;longContext:false;images:false;retries:0;fallbacks:0;
 components:{kind:'input'|'output'|'cache'|'image'|'request'|'gateway'|'surcharge'|'payment'|'reporting'|'drains';rateNanoUsd:number;maxUnits:number;proofSha256:string}[];
}
const hex=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
/** Arithmetic and enforced scope, not an assertion that public docs establish the submitted premises.
 * The independent-review receipt MUST also bind this exact certificate digest at execute/replay.
 * No complete real certificate is bundled: observed official evidence remains HOLD.
 */
export function checkBilling(c:BillingCertificate,input:{mode:string;questions:object},body:string,headers:Record<string,string>):number {
 requireValue(c?.schema==='jev.reviewed-billing-bound.v1'&&c.model===MODEL&&c.endpoint===ENDPOINT&&c.mode===input.mode&&['text','research','routing'].includes(c.mode),'BILLING_MODE_HELD');
 requireValue(hex(c.pricingSha256)&&hex(c.outputSchemaSha256)&&c.boundMethod==='reviewed-context-rejection','BILLING_EVIDENCE_REQUIRED');
 requireValue(c.officialEvidence.length>0&&c.officialEvidence.length<=16&&c.officialEvidence.every(p=>/^https:\/\/(?:ai-gateway\.vercel\.sh|vercel\.com|docs\.typesafe\.ai)\//.test(p.url)&&hex(p.sha256)),'BILLING_OFFICIAL_EVIDENCE');
 for(const k of ['maxInputTokens','maxQuestions','maxBodyBytes','maxRequestWindow','maxQuestionWindow']as const)requireValue(integer(c[k])>0,'BILLING_BOUND');
 requireValue(c.maxQuestions<=16&&Object.keys(input.questions).length<=c.maxQuestions&&c.maxBodyBytes<=16384&&Buffer.byteLength(body)<=c.maxBodyBytes&&c.maxInputTokens<=c.maxRequestWindow&&c.maxQuestionWindow<=c.maxRequestWindow,'BILLING_BOUND');
 requireValue(c.longContext===false&&c.images===false&&c.retries===0&&c.fallbacks===0&&JSON.stringify(headers)==='{"Content-Type":"application/json"}','BILLING_HEADERS_OR_OPTIONS');
 const parsed=JSON.parse(body);requireValue(parsed.model===MODEL&&!parsed.assets&&JSON.stringify(parsed.providerOptions)==='{"gateway":{"only":["typesafe-ai"],"models":[]}}','BILLING_ROUTE_OPTIONS');
 const kinds=['input','output','cache','image','request','gateway','surcharge','payment','reporting','drains'];
 requireValue(c.components.length===kinds.length&&new Set(c.components.map(x=>x.kind)).size===kinds.length&&kinds.every(k=>c.components.some(x=>x.kind===k)),'BILLING_COMPONENT_COVERAGE');
 let total=0n;
 for(const p of c.components){requireValue(hex(p.proofSha256)&&c.officialEvidence.some(e=>e.sha256===p.proofSha256),'BILLING_COMPONENT_PROOF');integer(p.rateNanoUsd);integer(p.maxUnits);if(p.kind==='input')requireValue(p.maxUnits>=c.maxInputTokens&&p.rateNanoUsd>0,'BILLING_INPUT_BOUND');total+=(BigInt(p.rateNanoUsd)*BigInt(p.maxUnits)+999n)/1000n}
 requireValue(total>0n&&total<=10000000n&&total<=BigInt(Number.MAX_SAFE_INTEGER),'BILLING_CEILING');return Number(total);
}
export const certificateHash=(c:BillingCertificate)=>sha256(JSON.stringify(c));

export function checkPricing(c:BillingCertificate,bytes:Uint8Array):void {
 const catalog=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 const model=catalog.data?.find((m:any)=>m.id===MODEL);
 requireValue(model&&typeof model.pricing?.input==='string'&&typeof model.pricing?.output==='string','PRICING_MODEL_RECORD');
 function nano(s:string){requireValue(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,9})?$/.test(s),'PRICING_RATE_PRECISION');const [whole,frac='']=s.split('.');const n=BigInt(whole)*1000000000n+BigInt(frac.padEnd(9,'0'));requireValue(n<=BigInt(Number.MAX_SAFE_INTEGER),'PRICING_RATE_OVERFLOW');return Number(n)}
 requireValue(c.components.find(p=>p.kind==='input')?.rateNanoUsd===nano(model.pricing.input)&&c.components.find(p=>p.kind==='output')?.rateNanoUsd===nano(model.pricing.output),'PRICING_RATE_MISMATCH');
}
