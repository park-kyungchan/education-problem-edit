import {assertPublicExposure,type PublicInventory} from './exposure.ts';
import {resolve,isAbsolute} from 'node:path';
import {sha256,requireValue,integer} from './admission.ts';
export interface ControlPacket {
  caseId:string; directory:string; request:string;
  exposure:{path:string;sha256:string;role:'request'|'evidence'|'image'}[];
  schemaPath:string; outputPath:string; inventory?:PublicInventory;
}
export interface HelpPin {binary:string;sha256:string;version:string;execHelp:string}
export interface NativeInvocation {
  argv:string[]; stdin:string; packet:ControlPacket; helpSha256:string; help:HelpPin;
  contentSha256:string;
  maxEventBytes:number; maxTotalBytes:number; liveHold:string;
}
const hex=(s:string)=>/^[a-f0-9]{64}$/.test(s);
export function prepareControl(packet:ControlPacket,help:HelpPin):NativeInvocation {
  requireValue(isAbsolute(help.binary)&&hex(help.sha256)&&help.execHelp.includes('--json')&&help.execHelp.includes('--output-schema')&&help.execHelp.includes('--sandbox')&&help.execHelp.includes('--skip-git-repo-check'),'NATIVE_HELP_NOT_QUALIFIED');
  requireValue(packet.caseId.length>0&&isAbsolute(packet.directory)&&Buffer.byteLength(packet.request)<=16384,'CONTROL_PACKET_BOUND');
  requireValue(packet.exposure.length>0&&packet.exposure.length<=32,'EXPOSURE_BOUND');
  const inside=(path:string)=>resolve(path).startsWith(resolve(packet.directory)+'/');
  for(const e of packet.exposure){
    requireValue(['request','evidence','image'].includes(e.role)&&hex(e.sha256)&&inside(e.path),'PRIVATE_OR_UNDECLARED_EXPOSURE');

  }
  assertPublicExposure(packet.caseId,packet.exposure,packet.inventory);
  requireValue(inside(packet.schemaPath)&&inside(packet.outputPath)&&!packet.exposure.some(e=>resolve(e.path)===resolve(packet.outputPath)),'CONTROL_OUTPUT_PATH');
  const argv=[help.binary,'exec','--skip-git-repo-check','--cd',packet.directory,'--model','gpt-6.1-sol','--config','model_reasoning_effort="high"','--sandbox','read-only','--json','--output-schema',packet.schemaPath,'--output-last-message',packet.outputPath];
  for(const e of packet.exposure.filter(e=>e.role==='image'))argv.push('--image',e.path);
  argv.push('-');
  // Native initial AGENTS/config/tools add context. This wrapper cannot assert read isolation.
  const stdin=JSON.stringify({caseId:packet.caseId,request:packet.request,exposure:packet.exposure});
  return {argv,stdin,packet:structuredClone(packet),helpSha256:help.sha256,help:structuredClone(help),contentSha256:sha256(JSON.stringify({argv,stdin,packet})),maxEventBytes:65536,maxTotalBytes:262144,liveHold:'FRESH_NATIVE_INFERENCE_NOT_ADMITTED; ACTUAL_EXPOSURE_MUST_BE_RECORDED'};
}
export interface NativeExecutor {
  kind:string;
  run:(invocation:NativeInvocation,onLine:(line:string)=>void)=>Promise<{exitCode:number;lastMessage:string}>;
}
/** Capture helper; production admission and the actual spawn primitive are owned by bindings.ts. */
export async function executeControl(inv:NativeInvocation,executor:NativeExecutor){
  requireValue(canonicalInvocation(inv),'NONCANONICAL_NATIVE_ARGV');
  requireValue(inv.argv[1]==='exec'&&!inv.argv.includes('resume')&&!inv.argv.includes('fork')&&inv.argv.at(-1)==='-','FRESH_EXEC_REQUIRED');
  requireValue(inv.argv.includes('--json')&&inv.argv.includes('gpt-6.1-sol')&&inv.argv.includes('model_reasoning_effort="high"')&&!inv.argv.some(x=>x.includes('bypass')),'CONTROL_CONFIGURATION_CHANGED');
  requireValue(sha256(JSON.stringify({argv:inv.argv,stdin:inv.stdin,packet:inv.packet}))===inv.contentSha256&&inv.maxEventBytes===65536&&inv.maxTotalBytes===262144,'CONTROL_PACKET_MUTATED');
  const events:unknown[]=[];const observedReads:string[]=[];const turns=new Set<string>();
  let bytes=0,threadId:string|null=null,returnedModel:string|null=null;
  let input:number|null=null,cached:number|null=null,output:number|null=null;
  let modelMismatch=false;
  let contaminated=false,completed=false,cacheComplete=true,usageComplete=true,unidentifiedTurn=false;
  const processLine=(line:string)=>{
    bytes+=Buffer.byteLength(line)+1;
    requireValue(Buffer.byteLength(line)<=inv.maxEventBytes&&bytes<=inv.maxTotalBytes,'NATIVE_OUTPUT_BOUND');
    const e=JSON.parse(line);requireValue(e&&typeof e.type==='string','INVALID_NATIVE_EVENT');events.push(e);
    if(e.type==='thread.started'){requireValue(typeof e.thread_id==='string'&&threadId===null,'NATIVE_THREAD_ID');threadId=e.thread_id;}
    if(e.type==='turn.completed'){
      if(e.turn_id===undefined){requireValue(!completed&&turns.size===0,'RESET_SAFE_TURN_BOUNDARY_REQUIRED');unidentifiedTurn=true;}
      else {requireValue(typeof e.turn_id==='string'&&!unidentifiedTurn&&!turns.has(e.turn_id),'RESET_SAFE_TURN_ID_REQUIRED');turns.add(e.turn_id);}
      if(e.usage){
        const i=integer(e.usage.input_tokens),o=integer(e.usage.output_tokens);
        input=integer((input??0)+i);output=integer((output??0)+o);
        if(e.usage.cached_input_tokens!==undefined){const c=integer(e.usage.cached_input_tokens);requireValue(c<=i,'INVALID_NATIVE_CACHE_USAGE');if(cacheComplete)cached=integer((cached??0)+c)}else {cacheComplete=false;cached=null;}
      }else {usageComplete=false;input=null;output=null;cached=null;cacheComplete=false;}
      completed=true;
    }
    if(typeof e.model==='string'){returnedModel=e.model;if(e.model!=='gpt-6.1-sol')modelMismatch=true;}
    if(e.type==='item.completed'){
      const item=e.item;requireValue(item&&typeof item.type==='string','INVALID_NATIVE_ITEM');
      // Commands, tool calls and unclassified reads are retained, never presumed isolated.
      if(item.type==='command_execution'||item.type==='mcp_tool_call'||item.type==='web_search')contaminated=true;
      if(Array.isArray(item.read_paths))for(const p of item.read_paths){requireValue(typeof p==='string','INVALID_NATIVE_READ');observedReads.push(p);if(!inv.packet.exposure.some(e=>resolve(e.path)===resolve(p)))contaminated=true;}
    }
  };
  try{
    const result=await executor.run(inv,processLine);
    requireValue(result.exitCode===0&&completed&&threadId!==null,'NATIVE_EXECUTION_INCOMPLETE');
    requireValue(Buffer.byteLength(result.lastMessage)<=65536,'NATIVE_MESSAGE_BOUND');
    const value=JSON.parse(result.lastMessage);requireValue(value&&typeof value==='object'&&!Array.isArray(value),'NATIVE_RESULT_NOT_OBJECT');
    return {disposition:contaminated||modelMismatch?'held':'captured',threadId,returnedModel,modelAttestation:returnedModel===null?'unattested':modelMismatch?'explicit-mismatch':'event-reported-not-independent-serving-proof',turnIds:unidentifiedTurn?[null]:[...turns],usage:{inputTokens:usageComplete?input:null,cachedInputTokens:cacheComplete?cached:null,uncachedInputTokens:!usageComplete||input===null||cached===null?null:input-cached,outputTokens:usageComplete?output:null},nativeUsd:null,output:value,outputSha256:sha256(result.lastMessage),events,observedReads,exposureCompleteness:'not-proven',comparisonQualification:'held-until-independent-actual-exposure-review',nativeCLIInvocationProxy:1,providerAttempts:null,sharedOrchestrationOverhead:null,acceptanceDecision:null};
  }catch(e){return {disposition:'held',reason:e instanceof Error?e.message:'NATIVE_CAPTURE_FAILED',events,observedReads,threadId,usage:null,nativeUsd:null,nativeCLIInvocationProxy:1,providerAttempts:null,sharedOrchestrationOverhead:null,acceptanceDecision:null};}
}

export function canonicalInvocation(inv:NativeInvocation):boolean {try{const rebuilt=prepareControl(inv.packet,inv.help);return JSON.stringify(rebuilt)===JSON.stringify(inv)}catch{return false}}
