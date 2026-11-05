/** Source-bound batch preparation. Filesystem reads only; no model or authoring decisions. */
import {createHash} from "node:crypto";
import {readFileSync, realpathSync} from "node:fs";
import {resolve, sep} from "node:path";
import {planSourceQuestion, type Atom} from "./production";
import {createUnitManifest} from "./question";

export interface FilePin {path: string; sha256: string}
export interface CompositionJob {
  schema: "problem-edit.composition-job.v1";
  sourcePdf: FilePin;
  questions: FilePin[];
  settings: FilePin;
  figures: {id: string; png: FilePin; svg: FilePin; width: number}[];
  equationOverrides?: {templateId: string; latex: string; script: string; reason: string}[];
  equationMeasurements?: FilePin;
}

function need(value: unknown, code: string): asserts value {
  if (!value) throw Error(`production_${code}@src/native-production.ts:1`);
}
export function prepareNativeBatch(raw: any, runRoot: string) {
  need(raw?.schema === "problem-edit.composition-job.v1", "composition_schema");
  const root = realpathSync(runRoot);
  const pins: {path: string; sha256: string}[] = [];
  const file = (pin: any) => {
    need(pin && typeof pin.path === "string" && /^[a-f0-9]{64}$/.test(pin.sha256), "input_pin");
    need(!pin.path.startsWith("/") && !pin.path.includes("\\") && !pin.path.split("/").some((p: string) => !p || p === "." || p === ".."), "input_path");
    const path = realpathSync(resolve(root, pin.path));
    need(path.startsWith(root + sep), "input_outside_root");
    need(createHash("sha256").update(readFileSync(path)).digest("hex") === pin.sha256, "input_changed");
    pins.push({path, sha256: pin.sha256});
    return path;
  };
  file(raw.sourcePdf);
  need(Array.isArray(raw.questions) && raw.questions.length > 0, "composition_questions");
  const packets = raw.questions.map((pin: any) => {
    const path = file(pin);
    const packet = planSourceQuestion(JSON.parse(readFileSync(path, "utf8")), raw.sourcePdf.sha256);
    file({path: packet.source.cropPath, sha256: packet.source.cropSha256});
    return packet;
  }).sort((a: any, b: any) => a.source.logicalOrder - b.source.logicalOrder);
  need(new Set(packets.map((q: any) => q.questionId)).size === packets.length, "duplicate_question");
  need(new Set(packets.map((q: any) => q.source.logicalOrder)).size === packets.length, "duplicate_logical_order");
  const settings = JSON.parse(readFileSync(file(raw.settings), "utf8"));
  need(settings?.font && typeof settings.font === "object", "font_settings");
  settings.font.path = file(settings.font);
  need(Array.isArray(raw.figures), "figure_assets");
  const figures = raw.figures.map((f: any) => ({...f, png: {...f.png, path: file(f.png)}, svg: {...f.svg, path: file(f.svg)}}));
  const figureIds = packets.flatMap((q: any) => q.blocks.filter((b: any) => b.kind === "figure").map((b: any) => b.id));
  need(figures.length === new Set(figureIds).size && new Set(figures.map((f: any) => f.id)).size === figures.length && figureIds.every((id: string) => figures.some((f: any) => f.id === id)), "figure_coverage");
  const templates: any[] = [], templateMap = new Map<string, any>();
  const register = (q: any, atoms: Atom[], role: string) => atoms.map(a => {
    if (a.kind !== "equation") return a;
    const templateId = `${q.questionId}::${role}::${a.itemId}`;
    if (!templateMap.has(templateId)) {
      const t = {id: templateId, questionId: q.questionId, itemId: a.itemId, role, latex: a.latex, converterLatex: a.converterLatex,limitApproaches:a.limitApproaches,limitPresentationAdaptations:a.limitPresentationAdaptations};
      templates.push(t); templateMap.set(templateId, t);
    }
    return {...a, templateId};
  });
  for (const q of packets) for (const b of q.blocks) {
    if (b.kind === "paragraph") b.atoms = register(q, b.atoms, "body");
    if (b.kind === "statement-box" || b.kind === "box") {
      b.titleAtoms = register(q, b.titleAtoms, "body");
      for (const item of b.items) item.atoms = register(q, item.atoms, "body");
    }
    if (b.kind === "choices") for (const item of b.items) item.atoms = register(q, item.atoms, "choice");
  }
  const overrides = raw.equationOverrides ?? [];
  need(Array.isArray(overrides) && new Set(overrides.map((o: any) => o.templateId)).size === overrides.length, "equation_overrides");
  for (const o of overrides) {
    const t = templateMap.get(o.templateId);
    need(t && o.latex === t.latex && typeof o.script === "string" && o.script.trim() && typeof o.reason === "string" && o.reason.trim(), "equation_override_binding");
    t.override = {script: o.script, reason: o.reason};
  }
  let equationMeasurements: any = null;
  if(raw.equationMeasurements){
    equationMeasurements=JSON.parse(readFileSync(file(raw.equationMeasurements),"utf8"));
    need(equationMeasurements?.schema==="problem-edit.equation-measurements.v1"&&equationMeasurements.sourceSha256===raw.sourcePdf.sha256&&Array.isArray(equationMeasurements.entries),"equation_measurements");
    need(new Set(equationMeasurements.entries.map((m:any)=>m.scriptSha256)).size===equationMeasurements.entries.length,"duplicate_equation_measurement");
    for(const m of equationMeasurements.entries){
      need(/^[a-f0-9]{64}$/.test(m.scriptSha256)&&Number.isSafeInteger(m.width)&&m.width>0&&Number.isSafeInteger(m.height)&&m.height>0&&(m.baselineHwpUnits===undefined||(Number.isFinite(m.baselineHwpUnits)&&m.baselineHwpUnits>0&&m.baselineHwpUnits<m.height)),"equation_measurement_dimensions");
      file(m.svg);
      if(m.baselineSvg)file(m.baselineSvg);
    }
  }
  return {
    schema: "problem-edit.native-batch.v1", runRoot: root, sourceSha256: raw.sourcePdf.sha256,
    packets, templates, figures, settings, inputPins: pins, equationMeasurements,
    holds: packets.flatMap((q: any) => q.holds.map((issue: string) => ({questionId: q.questionId, issue}))),
    unitSeeds: packets.map((q: any) => createUnitManifest({sourceSha256: raw.sourcePdf.sha256, questionId: q.questionId, physicalPage: q.source.physicalPage, logicalOrder: q.source.logicalOrder, crop: q.source.xyxy})),
    humanAcceptance: "not-granted", nativeHancomStatus: "unknown",
  };
}
