/** Finite selected-image patch entrypoint; no agent runtime, reauthoring, or paid call. */
import {resolve} from 'node:path';
const job=process.argv[2];if(!job)throw Error('Usage: bun patch-images.ts /absolute/path/to/job.json');
const p=Bun.spawnSync(['python3',resolve(import.meta.dir,'patch_images.py'),resolve(job)],{stdout:'pipe',stderr:'pipe'});
if(p.exitCode)throw Error(p.stderr.toString());console.log(p.stdout.toString());
