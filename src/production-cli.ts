/** Read-only adapters for compact production packets and measured layout decisions. */
import {readFileSync,realpathSync} from "node:fs";
import {resolve,sep} from "node:path";
import {createHash} from "node:crypto";
import {fitChoiceGrid,planSourceQuestion,wrapMeasuredAtoms} from "./production";
function need(v:unknown,code:string):asserts v{if(!v)throw Error(`production_${code}@src/production-cli.ts:1`);}
export function runProductionCli(args:string[]):unknown{
 const flags:Record<string,readonly string[]>={packet:["--file","--source-sha","--root"],fit:["--file"]};
 if(!args.length||args[0]==="help"){need(args.length<=1,"argument");return {commands:flags,contracts:["src/production.ts","tests/production.test.ts"],packet:"One source-bound question only; unresolved source/meaning holds are explicit; every repeated equation occurrence gets its own stable ID.",fit:"Measured widths, explicit legal break boundaries and recipe constants determine all lines and choice rows. Overflow fails; no shrinking or truncation.",writes:false,nativeHancomStatus:"unknown"};}
 const cmd=args[0];need(Object.hasOwn(flags,cmd),"usage");const v:Record<string,string>={};
 for(let i=1;i<args.length;i+=2){need(flags[cmd].includes(args[i])&&!Object.hasOwn(v,args[i])&&args[i+1]&&!args[i+1].startsWith("--"),"argument");v[args[i]]=args[i+1];}
 for(const f of flags[cmd])need(v[f],"missing_"+f.slice(2).replaceAll("-","_"));
 let raw:any;try{raw=JSON.parse(readFileSync(v["--file"],"utf8"));}catch{throw Error("production_json_input@src/production-cli.ts:1");}
 if(cmd==="fit"){
  need(raw&&Array.isArray(raw.paragraphs),"measured_paragraphs");const ids=new Set<string>();
  return {paragraphs:raw.paragraphs.map((p:any)=>{need(typeof p.id==="string"&&p.id.trim()&&!ids.has(p.id),"measured_paragraph_id");ids.add(p.id);return {id:p.id,lines:wrapMeasuredAtoms(p.atoms,raw.width)};}),choices:raw.choices?fitChoiceGrid(raw.choices,raw.width,raw.choiceSettings):null};
 }
 const packet=planSourceQuestion(raw,v["--source-sha"]);const root=realpathSync(v["--root"]),crop=realpathSync(resolve(root,packet.source.cropPath));
 need(crop.startsWith(root+sep),"source_crop_outside_root");
 need(createHash("sha256").update(readFileSync(crop)).digest("hex")===packet.source.cropSha256,"source_crop_changed");
 return packet;
}
