/** Qualified preview metrics with an invariant appended baseline probe.
 * No source interpretation or native Hancom certification. Dependencies are explicit.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const args=process.argv.slice(2),values={};
const started=performance.now();
const need=(v,code)=>{if(!v)throw Error(`production_${code}@packages/native-production/equation-metrics.mjs:1`);};
for(let i=0;i<args.length;i+=2){need(['--input','--root','--dependencies','--out','--reuse'].includes(args[i])&&!Object.hasOwn(values,args[i])&&args[i+1],'metric_argument');values[args[i]]=args[i+1];}
for(const key of ['--input','--root','--dependencies','--out'])need(values[key],'metric_argument');
const root=fs.realpathSync(values['--root']),output=path.resolve(root,values['--out']);
need(output.startsWith(root+path.sep)&&!fs.existsSync(output),'metric_output_exists_or_outside_root');
const parent=fs.realpathSync(path.dirname(output));need(parent===root||parent.startsWith(root+path.sep),'metric_output_parent');
const input=fs.realpathSync(values['--input']);need(input.startsWith(root+path.sep),'metric_input_outside_root');
const data=JSON.parse(fs.readFileSync(input,'utf8')),require=createRequire(path.resolve(values['--dependencies'],'package.json'));
need(Array.isArray(data.equations)&&data.equations.every(e=>typeof e.requiresMeasurement==='boolean'),'metric_input_requires_measure_command');
const entry=require.resolve('@rhwp/core');
const renderer='@rhwp/core@'+JSON.parse(fs.readFileSync(path.join(path.dirname(entry),'package.json'),'utf8')).version;
const hash=data=>createHash('sha256').update(data).digest('hex');
need(hash(fs.readFileSync(data.settings.font.path))===data.settings.font.sha256,'metric_font_changed');
const cache=new Map();
if(values['--reuse']){
 const reuse=fs.realpathSync(values['--reuse']);need(reuse.startsWith(root+path.sep),'metric_cache_outside_root');
 const previous=JSON.parse(fs.readFileSync(reuse,'utf8'));
 need(previous.schema==='problem-edit.equation-measurements.v1'&&previous.sourceSha256===data.sourceSha256&&previous.baseUnit===data.settings.equationBaseUnit&&previous.fontSha256===data.settings.font.sha256&&previous.renderer===renderer,'metric_cache_identity');
 for(const e of previous.entries){
  need(/^[a-f0-9]{64}$/.test(e.scriptSha256)&&!cache.has(e.scriptSha256)&&Number.isSafeInteger(e.width)&&e.width>0&&Number.isSafeInteger(e.height)&&e.height>0&&Number.isFinite(e.baselineHwpUnits)&&e.baselineHwpUnits>0&&e.baselineHwpUnits<e.height,'metric_cache_entry');
  for(const pin of [e.svg,e.baselineSvg]){
   need(pin&&typeof pin.path==='string'&&!path.isAbsolute(pin.path),'metric_cache_pin');const p=fs.realpathSync(path.resolve(root,pin.path));
   need(p.startsWith(root+path.sep)&&hash(fs.readFileSync(p))===pin.sha256,'metric_cache_changed');
  }
  cache.set(e.scriptSha256,e);
 }
}
let doc;
async function ensureRenderer(){
 if(doc)return;
 const {default:init,HwpDocument}=await import(pathToFileURL(entry));
 const {createCanvas,GlobalFonts}=require('@napi-rs/canvas');
 GlobalFonts.registerFromPath(data.settings.font.path,data.settings.font.name);
 const ctx=createCanvas(1,1).getContext('2d');
 globalThis.measureTextWidth=(font,text)=>{ctx.font=font.replace(/"[^"]+"|'[^']+'|serif|sans-serif/g,JSON.stringify(data.settings.font.name));return ctx.measureText(text).width;};
 await init({module_or_path:fs.readFileSync(path.join(path.dirname(entry),'rhwp_bg.wasm'))});doc=HwpDocument.createEmpty();
}
const entries=[],seen=new Set();let reused=0;
const proofs=[];
for(const e of data.equations){
 const scriptSha256=hash(e.script);if(seen.has(scriptSha256))continue;seen.add(scriptSha256);
 if(cache.has(scriptSha256)){entries.push(cache.get(scriptSha256));reused++;continue;}
 await ensureRenderer();
 const svg=doc.renderEquationPreview(e.script,data.settings.equationBaseUnit,0);
 const probe=doc.renderEquationPreview(e.script+'"PEBaselineProbe"',data.settings.equationBaseUnit,0);
 const box=svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/),probeBox=probe.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
 const originalBody=svg.slice(svg.indexOf('>')+1,svg.lastIndexOf('</svg>'));
 const probeBody=probe.slice(probe.indexOf('>')+1,probe.lastIndexOf('</svg>'));
 const tail=probeBody.slice(originalBody.length).match(/^<text\b[^>]*\by="([\d.]+)"[^>]*>PEBaselineProbe<\/text>\s*$/);
 need(box&&probeBox&&box[2]===probeBox[2]&&probeBody.startsWith(originalBody)&&tail,'metric_baseline_unqualified');
 const width=Math.ceil(Number(box[1])*75),height=Math.ceil(Number(box[2])*75),baselineHwpUnits=Number(tail[1])*75;
 need(width>0&&height>0&&baselineHwpUnits>0&&baselineHwpUnits<height,'metric_dimensions');
 const name=scriptSha256+'.svg',relative=path.relative(root,path.join(output,name));
 const probeName=scriptSha256+'-baseline.svg';
 entries.push({scriptSha256,width,height,baselineHwpUnits,svg:{path:relative,sha256:hash(svg)},baselineSvg:{path:path.relative(root,path.join(output,probeName)),sha256:hash(probe)},method:'Exact script preview box; appended baseline probe admitted only when all original SVG children and height are byte-identical. 1 CSS px = 75 HWP units.'});proofs.push({name,svg},{name:probeName,svg:probe});
}
fs.mkdirSync(output);
for(const proof of proofs)fs.writeFileSync(path.join(output,proof.name),proof.svg,{flag:'wx'});
const result={schema:'problem-edit.equation-measurements.v1',sourceSha256:data.sourceSha256,baseUnit:data.settings.equationBaseUnit,fontSha256:data.settings.font.sha256,renderer,entries,nativeHancomStatus:'unknown'};
fs.writeFileSync(path.join(output,'measurements.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({path:path.join(output,'measurements.json'),entries:entries.length,reusedEntries:reused,newlyMeasuredEntries:entries.length-reused,elapsedMs:Math.round(performance.now()-started),nativeHancomStatus:'unknown'}));
