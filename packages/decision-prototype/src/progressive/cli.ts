import {prepareJev} from './jev.ts';
/** stdin-only preparation. Does not open a ledger, load credentials, send, spawn or write files. */
export async function progressiveCli(args:string[],stdin?:string):Promise<string>{
  if(args.length===0||args[0]==='--help')return 'progressive prepare < stage-input.json\nprogressive validate < owner-validation.json\nPure request preparation and offline validation only. All live/native effects held.\n';
  if(args.length===1&&args[0]==='validate'){const {validateOffline,readOfflineInput}=await import('./offline-validation.ts');return JSON.stringify(validateOffline(await readOfflineInput(stdin)),null,2)+'\n'}
  if(args.length!==1||args[0]!=='prepare')throw Error('UNSUPPORTED_COMMAND_LIVE_HELD');
  let raw=stdin;
  if(raw===undefined){
    const reader=Bun.stdin.stream().getReader();const chunks:Uint8Array[]=[];let bytes=0;
    try {for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>24*1024){await reader.cancel();throw Error('STDIN_BOUND')}chunks.push(part.value)}}finally{reader.releaseLock()}
    raw=Buffer.concat(chunks).toString('utf8');
  }
  if(Buffer.byteLength(raw)>24*1024)throw Error('STDIN_BOUND');
  return JSON.stringify(prepareJev(JSON.parse(raw)),null,2)+'\n';
}
if(import.meta.main)console.log(await progressiveCli(Bun.argv.slice(2)));
