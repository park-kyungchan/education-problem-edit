/** Read-only official-source capture. No native Hancom operation or provider inference. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { json, sha256 } from './lib';
const destination=resolve(import.meta.dir,'../research/hancom/2026-10-22');
await mkdir(resolve(destination,'sources'),{recursive:true});
const api=await fetch('https://api.github.com/repos/hancom-io/devcenter-archive/commits/main');
if(!api.ok)throw new Error(`Official archive main query failed: ${api.status}`);
const commit=await api.json() as {sha:string};
const modelResponse=await fetch('https://api.github.com/repos/hancom-io/hwpx-owpml-model/git/trees/main?recursive=1');
if(!modelResponse.ok)throw new Error(`Official model tree query failed: ${modelResponse.status}`);
const modelTree=await modelResponse.json() as {sha:string;tree:{path:string;type:string}[]};
await writeFile(resolve(destination,'model-tree.json'),json(modelTree));
const archive=`https://raw.githubusercontent.com/hancom-io/devcenter-archive/${commit.sha}/hwp-automation/`;
const requests=[
  ...['ActionTable_2504.pdf','ParameterSetTable_2504.pdf','HwpAutomation_2504.pdf','ActionObject.pdf','ParameterSetObject.pdf','한글오토메이션EventHandler추가_2504.pdf'].map(name=>({id:name.replace('.pdf',''),url:archive+encodeURIComponent(name),file:name})),
  {id:'automation-guide',url:'https://developer.hancom.com/hwpautomation',file:'automation-guide.html'},
  {id:'desktop-web-boundary',url:'https://forum.developer.hancom.com/t/hwpctrl-api/1517.json',file:'desktop-web-boundary.json'},
  {id:'hwpx-saveblock',url:'https://forum.developer.hancom.com/t/gettextfile-hwpx-saveblock/3102.json',file:'hwpx-saveblock.json'},
  {id:'equation-commands',url:'https://help.hancom.com/hoffice130_assistant/ko-KR/Hwp/insert/equation/equation%28explanation%29.htm',file:'equation-commands.html'},
  {id:'equation-rules',url:'https://help.hancom.com/hoffice120/ko-KR/Hwp/insert/equation/equation%28rule%29.htm',file:'equation-rules.html'},
  {id:'web-api',url:'https://developer.hancom.com/webhwp/devguide/hwpctrl',file:'web-api.html'},
  {id:'format-guide',url:'https://www.hancom.com/support/downloadCenter/hwpOwpml',file:'format-guide.html'},
  {id:'sdk-guide',url:'https://www.hancom.com/product/sdk/hwpSdk',file:'sdk-guide.html'},
  {id:'equation-format',url:'https://cdn.hancom.com/link/docs/%ED%95%9C%EA%B8%80%EB%AC%B8%EC%84%9C%ED%8C%8C%EC%9D%BC%ED%98%95%EC%8B%9D_%EC%88%98%EC%8B%9D_revision1.3.pdf',file:'equation-format.pdf'},
  {id:'model-readme',url:`https://raw.githubusercontent.com/hancom-io/hwpx-owpml-model/${modelTree.sha}/README.md`,file:'model-readme.md'},
  {id:'validator-readme',url:'https://raw.githubusercontent.com/hancom-io/dvc/main/README.md',file:'validator-readme.md'},
];
const results=await Promise.allSettled(requests.map(async item=>{
  const started=Date.now(),response=await fetch(item.url,{signal:AbortSignal.timeout(30000)}),data=new Uint8Array(await response.arrayBuffer());
  const validType=!item.file.endsWith('.pdf')||new TextDecoder().decode(data.slice(0,5))==='%PDF-';
  const receipt={...item,status:response.status,finalUrl:response.url,contentType:response.headers.get('content-type'),bytes:data.length,sha256:sha256(data),capturedAt:new Date().toISOString(),wallMs:Date.now()-started,localPath:`sources/${item.file}`,state:!response.ok?'failed-http':!validType?'failed-content-type':'captured'};
  await writeFile(resolve(destination,'sources',item.file),data);return receipt;
}));
const receipts=results.map((result,i)=>result.status==='fulfilled'?result.value:{...requests[i],state:'failed',error:String(result.reason)});
await writeFile(resolve(destination,'capture.json'),json({schema:'hancom.official-source-capture.v1',archiveMainObserved:commit.sha,modelMainObserved:modelTree.sha,receipts,newPaidCalls:0,nativeEffects:0}));
console.log(json({destination,archiveMain:commit.sha,modelMain:modelTree.sha,results:receipts.map(r=>({id:r.id,state:r.state,...('status'in r?{status:r.status,bytes:r.bytes}:{})}))}));
