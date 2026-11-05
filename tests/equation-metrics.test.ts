import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
test('qualified cache identity/bytes are required; cache-only deduplication never imports the renderer',()=>{
 const root=mkdtempSync(join(tmpdir(),'metric-cache-'));
 try{
  const deps=join(root,'node_modules'),core=join(deps,'@rhwp/core');mkdirSync(core,{recursive:true});
  writeFileSync(join(core,'package.json'),JSON.stringify({name:'@rhwp/core',version:'0.0.0-synthetic',main:'index.js',type:'module'}));
  writeFileSync(join(core,'index.js'),"throw Error('Synthetic renderer must not load on a cache-only run');");
  const font=join(root,'font.otf');writeFileSync(font,'synthetic font bytes');
  const scripts=['x`','x`','y`'];const input={sourceSha256:'a'.repeat(64),settings:{font:{path:font,name:'Synthetic',sha256:hash('synthetic font bytes')},equationBaseUnit:1100},equations:scripts.map(script=>({script,requiresMeasurement:false}))};
  const entries=[...new Set(scripts)].map((s,i)=>{
   const svg=`synthetic-${i}.svg`,body='<svg xmlns="http://www.w3.org/2000/svg"/>';writeFileSync(join(root,svg),body);
   return {scriptSha256:hash(s),width:100,height:100,baselineHwpUnits:50,svg:{path:svg,sha256:hash(body)},baselineSvg:{path:svg,sha256:hash(body)},method:'Synthetic cache-validation fixture only; not real measurement qualification.'};
  });
  const cache={schema:'problem-edit.equation-measurements.v1',sourceSha256:input.sourceSha256,baseUnit:1100,fontSha256:input.settings.font.sha256,renderer:'@rhwp/core@0.0.0-synthetic',entries};
  const file=join(root,'input.json'),reuse=join(root,'cache.json');writeFileSync(file,JSON.stringify(input));writeFileSync(reuse,JSON.stringify(cache));
  const run=(out:string)=>Bun.spawnSync(['node',join(import.meta.dir,'../packages/native-production/equation-metrics.mjs'),'--input',file,'--root',root,'--dependencies',deps,'--out',out,'--reuse',reuse],{stdout:'pipe',stderr:'pipe'});
  const ok=run('cache-only');expect(ok.exitCode,ok.stderr.toString()).toBe(0);expect(JSON.parse(ok.stdout.toString())).toMatchObject({entries:2,reusedEntries:2,newlyMeasuredEntries:0});
  expect(JSON.parse(readFileSync(join(root,'cache-only/measurements.json'),'utf8')).entries).toEqual(entries);
  writeFileSync(reuse,JSON.stringify({...cache,fontSha256:'0'.repeat(64)}));const badFont=run('wrong-font');expect(badFont.exitCode).not.toBe(0);expect(badFont.stderr.toString()).toContain('metric_cache_identity');expect(existsSync(join(root,'wrong-font'))).toBe(false);
  writeFileSync(reuse,JSON.stringify(cache));writeFileSync(join(root,entries[0].svg.path),'changed');const badSvg=run('wrong-svg');expect(badSvg.exitCode).not.toBe(0);expect(badSvg.stderr.toString()).toContain('metric_cache_changed');expect(existsSync(join(root,'wrong-svg'))).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
