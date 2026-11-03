import type { JevContext } from './types.ts';

export const HELP = `Jev-first (default live model: typesafe-ai/jev-1.14.0)
Usage:
  bun run jev-first.ts <decide|route|box|review> --input '<JSON>' [options]
  bun run jev-first.ts <decide|route|box|review> --input @/absolute/input.json [options]
  bun run jev-first.ts --help

Options:
  --task-id ID          Native caller task ID (required for live stages)
  --receipt-root PATH   Request/response receipt directory (required for live stages)
  --key-path PATH       Named AI_GATEWAY_API_KEY file, read only immediately before send
  --ledger-path PATH    Existing sole ledger path (no new ledger)
  --mode live          Default and only mode; no automatic retries or fallback
  --help, -h           Local help; no stage import, credential read or paid call

Stage inputs:
  decide  {request,state,stages,items,capabilities,sources,entities,artifacts,actions}
          Caller-defined finite stage/action bundles choose edit scope, available
          tool/skill/model role, exact source/entity and affected existing artifacts.
          Original/restored roles stay explicit; unreadable items use two interpretations.
          Returns a native-codex action plan; does not execute tools or diagram edits.
          Supply only bounded, current candidates; no truncation or score/eval gate.
  route   {request:string,documents?:[{id,url?,text}],candidates?:{id:description}}
  box     {imagePath:string,target:string,context?:unknown}
  review  {request:string,code?:string,scene?:unknown,originalImagePath?:string,restoredImagePath?:string}

Stage modules load only when selected. Each actual send reserves 250000 microUSD
in the existing sole ledger; the US$10 cap includes the 294 microUSD supplement.
No automatic correctness verification/evaluation follows decide. Direct route/box/review
remain available. A caller-supplied existing GPT role can be selected for native-owner
work; selection neither invokes it nor authorizes a paid call. AcceptanceDecision is null.
`;

type Stage = (input: any, context: JevContext) => Promise<unknown>;
async function loadStage(command: string): Promise<Stage> {
  // Dynamic paths keep help/import/syntax usable before other stage Tasks arrive.
  const file = command === 'decide' ? 'decisions.ts' : command === 'route' ? 'routing.ts' : command === 'box' ? 'box.ts' : 'review.ts';
  const exportName = command === 'decide' ? 'runDecision' : command === 'route' ? 'runRouting' : command === 'box' ? 'runBox' : 'runReview';
  const modulePath = new URL(`./${file}`, import.meta.url);
  if (!await Bun.file(modulePath).exists()) throw Error(`JEV_STAGE_NOT_READY: ${file} (${exportName})`);
  const stage = await import(modulePath.href);
  if (typeof stage[exportName] !== 'function') throw Error(`JEV_STAGE_EXPORT_REQUIRED: ${exportName}`);
  return stage[exportName];
}

export async function main(args: string[] = Bun.argv.slice(2)): Promise<number> {
  if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(HELP); return 0; }
  const [command, ...rest] = args;
  if (!['decide', 'route', 'box', 'review'].includes(command!)) throw Error('JEV_COMMAND_REQUIRED: decide|route|box|review');
  const options: Record<string, string> = {};
  const known = new Set(['--input', '--task-id', '--receipt-root', '--key-path', '--ledger-path', '--mode']);
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index]!, value = rest[index + 1];
    if (!known.has(name) || value === undefined || value.startsWith('--') || Object.hasOwn(options, name)) throw Error(`JEV_INVALID_OPTION: ${name}`);
    options[name] = value;
  }
  if ((options['--mode'] ?? 'live') !== 'live') throw Error('JEV_MODE_MUST_BE_LIVE');
  if (!options['--input'] || !options['--task-id']?.trim() || !options['--receipt-root']?.trim()) throw Error('JEV_REQUIRED: --input --task-id --receipt-root');
  const inputText = options['--input'].startsWith('@')
    ? await Bun.file(options['--input'].slice(1)).text() : options['--input'];
  const input = JSON.parse(inputText);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('JEV_INPUT_OBJECT_REQUIRED');
  if (command === 'box') {
    if (typeof input.imagePath !== 'string' || !input.imagePath.trim() || typeof input.target !== 'string' || !input.target.trim()) throw Error('JEV_BOX_INPUT_REQUIRED: imagePath,target');
  } else if (typeof input.request !== 'string' || !input.request.trim()) throw Error('JEV_REQUEST_STRING_REQUIRED');
  const context: JevContext = {
    taskId: options['--task-id'], receiptRoot: options['--receipt-root'],
    ...(options['--key-path'] ? { keyPath: options['--key-path'] } : {}),
    ...(options['--ledger-path'] ? { ledgerPath: options['--ledger-path'] } : {}),
  };
  const run = await loadStage(command!);
  const result = await run(input, context);
  console.log(JSON.stringify(result, null, 2));
  // Preserve failures rather than exit successfully after a failed/ambiguous paid result.
  const value = result as any;
  const status = value?.status ?? value?.rawResult?.status ?? value?.raw?.status ?? value?.result?.status;
  return status === 'error' || status === 'ambiguous' ? 1 : 0;
}

if (import.meta.main) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
