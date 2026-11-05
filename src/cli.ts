import { readFileSync } from "node:fs";
import { layouts, resolveLayout } from "./layout";
import { runReviewCli } from "./review-cli";
import { runProductionCli } from "./production-cli";
import {
  createUnitManifest,
  decodeUnitManifest,
  invalidateFrom,
  parseQuestionId,
  parseUnitSelection,
  planAssembly,
  planUnitWork,
  unitUnresolvedLedger,
  validateUnitManifest,
  type QuestionUnitManifest,
  type UnitStageId,
  unitStages,
} from "./question";

const USAGE =
  "Usage: layout list | layout resolve [--profile ID] [--existing ID] [--format hwp|hwpx] | unit parse <selection> [--available Q1,Q2] | unit new --source-sha <64hex> --question <id> --physical-page <n> [--logical-order <n>] [--crop x1,y1,x2,y2] | unit validate --file <manifest.json> | unit plan --file <manifest.json> | unit invalidate --file <manifest.json> --stage <stage> | unit assemble --file <a.json,b.json> | review help | production help";

function pairs(rest: string[], allowed: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!key?.startsWith("--") || !allowed.includes(key) || rest[i + 1] === undefined || rest[i + 1].startsWith("--") || key in values) {
      throw new Error(`Invalid argument: ${key}`);
    }
    values[key] = rest[i + 1];
  }
  return values;
}

function loadManifest(path: string): QuestionUnitManifest {
  // Single admission boundary: every manifest consumer gets a checked value.
  return decodeUnitManifest(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

const args = process.argv.slice(2);
try {
  if (args[0] === "layout") {
    if (args[1] === "list" && args.length === 2) {
      console.log(JSON.stringify({ profiles: layouts }, null, 2));
    } else if (args[1] === "resolve") {
      const values = pairs(args.slice(2), ["--profile", "--existing", "--format"]);
      console.log(JSON.stringify(resolveLayout({ requested: values["--profile"], existing: values["--existing"], format: values["--format"] }), null, 2));
    } else throw new Error(USAGE);
  } else if (args[0] === "production") {
    console.log(JSON.stringify(runProductionCli(args.slice(1)), null, 2));
  } else if (args[0] === "review") {
    console.log(JSON.stringify(runReviewCli(args.slice(1)), null, 2));
  } else if (args[0] === "unit") {
    const cmd = args[1];
    if (cmd === "parse") {
      const selection = args[2];
      if (!selection || selection.startsWith("--")) throw new Error(USAGE);
      const values = pairs(args.slice(3), ["--available"]);
      const available = values["--available"] ? values["--available"].split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      console.log(JSON.stringify(parseUnitSelection(selection, available), null, 2));
    } else if (cmd === "new") {
      const values = pairs(args.slice(2), ["--source-sha", "--question", "--physical-page", "--logical-order", "--crop"]);
      if (!values["--source-sha"] || !values["--question"] || !values["--physical-page"]) throw new Error(USAGE);
      const cropRaw = values["--crop"];
      const crop = cropRaw ? (cropRaw.split(",").map(Number) as [number, number, number, number]) : null;
      if (crop && (crop.length !== 4 || crop.some((n) => !Number.isFinite(n)))) throw new Error("Invalid --crop x1,y1,x2,y2");
      console.log(JSON.stringify(createUnitManifest({
        sourceSha256: values["--source-sha"],
        questionId: parseQuestionId(values["--question"]),
        physicalPage: Number(values["--physical-page"]),
        logicalOrder: values["--logical-order"] ? Number(values["--logical-order"]) : undefined,
        crop,
      }), null, 2));
    } else if (cmd === "validate") {
      const values = pairs(args.slice(2), ["--file"]);
      if (!values["--file"]) throw new Error(USAGE);
      const manifest = JSON.parse(readFileSync(values["--file"], "utf8")) as QuestionUnitManifest;
      const errors = validateUnitManifest(manifest);
      console.log(JSON.stringify({ valid: errors.length === 0, errors }, null, 2));
      if (errors.length) process.exitCode = 1;
    } else if (cmd === "plan") {
      const values = pairs(args.slice(2), ["--file"]);
      if (!values["--file"]) throw new Error(USAGE);
      const manifest = loadManifest(values["--file"]);
      console.log(JSON.stringify({ plan: planUnitWork(manifest), unresolved: unitUnresolvedLedger(manifest) }, null, 2));
    } else if (cmd === "invalidate") {
      const values = pairs(args.slice(2), ["--file", "--stage"]);
      if (!values["--file"] || !values["--stage"]) throw new Error(USAGE);
      if (!(unitStages as readonly string[]).includes(values["--stage"])) throw new Error(`Unknown stage: ${values["--stage"]}`);
      const manifest = loadManifest(values["--file"]);
      console.log(JSON.stringify(invalidateFrom(manifest, values["--stage"] as UnitStageId), null, 2));
    } else if (cmd === "assemble") {
      const values = pairs(args.slice(2), ["--file"]);
      if (!values["--file"]) throw new Error(USAGE);
      const manifests = values["--file"].split(",").map((p) => loadManifest(p.trim()));
      console.log(JSON.stringify(planAssembly(manifests), null, 2));
    } else throw new Error(USAGE);
  } else throw new Error(USAGE);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
