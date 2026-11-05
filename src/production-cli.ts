/** Read-only admission/planning plus explicit versioned native composition. */
import {readFileSync,realpathSync} from "node:fs";
import {resolve,sep} from "node:path";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {prepareNativeBatch} from "./native-production";
import {planNativeLayout} from "./native-layout";
import {fitChoiceGrid,planSourceQuestion,wrapMeasuredAtoms} from "./production";
import {planProductionAudit} from "./production-audit";
function need(v:unknown,code:string):asserts v{if(!v)throw Error(`production_${code}@src/production-cli.ts:1`);}
export function runProductionCli(args:string[]):unknown{
 const flags:Record<string,readonly string[]>={packet:["--file","--source-sha","--root"],fit:["--file"],batch:["--file","--root"],audit:["--file","--root"],inspect:["--file","--root","--python"],measure:["--file","--root","--python"],compose:["--file","--root","--python","--out"]};
 if(!args.length||args[0]==="help"){need(args.length<=1,"argument");return {commands:flags,contracts:["src/production.ts","src/limit-contract.ts","src/native-production.ts","packages/native-production/compose.py","tests/production.test.ts"],audit:"Read-only compact feature routes and source crop pins; no model calls, no claim of semantic certification.",inspect:"Read-only independent saved-bundle/raw-source readback; compact counts and explicit coverage limits.",measure:"Read-only finalized scripts for packages/native-production/equation-metrics.mjs --input <json> --root <root> --dependencies <node_modules> --out <new-dir> [--reuse <measurements.json>]. Cache reuse requires exact source/script/base-unit/font/renderer and SVG-byte identity.",packet:"One source-bound question only; unresolved source/meaning holds are explicit; every repeated equation occurrence gets its own stable ID.",equationMeaning:"One-sided limits require source-grounded limitApproaches with variable, target, direction, signPlacement and evidence. Missing/conflicting declarations fail before conversion. Preserve actual powers and signed two-sided endpoints; exact approach clauses are checked before measurement and in saved XML. This bounded check does not certify all mathematical semantics.",fit:"Measured widths, explicit legal break boundaries and recipe constants determine all lines and choice rows. Overflow fails; no shrinking or truncation.",batch:"Read-only pinned PDF/question/crop/font/assets admission; sorted packets, unique equation templates and fresh pending unit seeds. No prior exam paths/counts.",compose:"Only this command writes: new bounded version directory. Requires the explicit Python executable with packages/native-production/requirements.txt. Native table cells for all boxes/options; every measured EqEdit script ends in a single backtick half-space; internal ~ full-spaces remain. Independent rendered/source review and review release are still required.",jobSchema:"src/native-production.ts; tests/native-production.test.ts contains a complete synthetic job",writes:false,writingCommands:["compose"],nativeHancomStatus:"unknown"};}
 const cmd=args[0];need(Object.hasOwn(flags,cmd),"usage");const v:Record<string,string>={};
 for(let i=1;i<args.length;i+=2){need(flags[cmd].includes(args[i])&&!Object.hasOwn(v,args[i])&&args[i+1]&&!args[i+1].startsWith("--"),"argument");v[args[i]]=args[i+1];}
 for(const f of flags[cmd])need(v[f],"missing_"+f.slice(2).replaceAll("-","_"));
 if(cmd==="inspect"){
  const script=fileURLToPath(new URL("../packages/native-production/inspect_bundle.py",import.meta.url));
  const result=spawnSync(v["--python"],[script,v["--file"],v["--root"]],{encoding:"utf8",timeout:120000,maxBuffer:1024*1024});
  need(!result.error&&result.status===0,"inspect_failed: "+result.stderr.slice(-1500));return JSON.parse(result.stdout);
 }
 let raw:any,rawData:string;try{rawData=readFileSync(v["--file"],"utf8");raw=JSON.parse(rawData);}catch{throw Error("production_json_input@src/production-cli.ts:1");}
 if(cmd==="batch"||cmd==="audit"||cmd==="measure"||cmd==="compose"){
  const batch=prepareNativeBatch(raw,v["--root"]);
  const jobPath=realpathSync(v["--file"]);need(jobPath.startsWith(batch.runRoot+sep),"job_outside_root");
  batch.inputPins.push({path:jobPath,sha256:createHash("sha256").update(rawData).digest("hex")});
  if(cmd==="batch")return batch;
  if(cmd==="audit")return planProductionAudit(batch);
  need(batch.holds.length===0,"source_interview_required");
  const script=fileURLToPath(new URL("../packages/native-production/compose.py",import.meta.url));
  if(cmd==="measure"){
   const result=spawnSync(v["--python"],[script,"--phase","measure"],{input:JSON.stringify(batch),encoding:"utf8",timeout:120000,maxBuffer:16*1024*1024});
   need(!result.error&&result.status===0,"measure_failed: "+result.stderr.slice(-1500));return JSON.parse(result.stdout);
  }
  const out=resolve(v["--out"]),root=realpathSync(v["--root"]);
  need(out.startsWith(root+sep),"output_outside_root");
  const call=(phase:string,input:unknown)=>{
   const result=spawnSync(v["--python"],[script,"--phase",phase,"--out",out],{input:JSON.stringify(input),encoding:"utf8",timeout:120000,maxBuffer:16*1024*1024});
   need(!result.error&&result.status===0,"compose_failed: "+result.stderr.slice(-1500));
   return JSON.parse(result.stdout);
  };
  return call("emit",planNativeLayout(call("measure",batch)));
 }
 if(cmd==="fit"){
  need(raw&&Array.isArray(raw.paragraphs),"measured_paragraphs");const ids=new Set<string>();
  return {paragraphs:raw.paragraphs.map((p:any)=>{need(typeof p.id==="string"&&p.id.trim()&&!ids.has(p.id),"measured_paragraph_id");ids.add(p.id);return {id:p.id,lines:wrapMeasuredAtoms(p.atoms,raw.width)};}),choices:raw.choices?fitChoiceGrid(raw.choices,raw.width,raw.choiceSettings):null};
 }
 const packet=planSourceQuestion(raw,v["--source-sha"]);const root=realpathSync(v["--root"]),crop=realpathSync(resolve(root,packet.source.cropPath));
 need(crop.startsWith(root+sep),"source_crop_outside_root");
 need(createHash("sha256").update(readFileSync(crop)).digest("hex")===packet.source.cropSha256,"source_crop_changed");
 return packet;
}
