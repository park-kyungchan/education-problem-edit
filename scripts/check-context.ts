import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root=resolve(import.meta.dir,'..');
const coverage=JSON.parse(await readFile(resolve(root,'context/coverage.json'),'utf8'));
for(const f of coverage.files){
 const b=await readFile(resolve(root,f.path));
 if(b.length!==f.bytes||createHash('sha256').update(b).digest('hex')!==f.sha256)throw Error(`Imported context drift: ${f.path}`);
}
console.log(JSON.stringify({importedFiles:coverage.files.length,integrity:'passed',coverage:coverage.coverage}));
const result=Bun.spawnSync(['bun','run','packages/knowledge/src/cli.ts','validate'],{cwd:root,stdout:'pipe',stderr:'pipe'});
process.stdout.write(result.stdout);process.stderr.write(result.stderr);
if(result.exitCode!==0)process.exit(result.exitCode);
