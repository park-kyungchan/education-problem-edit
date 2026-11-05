/** Source-grounded approach direction is distinct from exponent typography. */
export interface LimitApproach {
  occurrence: number;
  variableLatex: string;
  targetLatex: string;
  direction: "left" | "right" | "two-sided";
  signPlacement: "baseline" | "superscript" | null;
  evidence: string;
}
function need(v: unknown, code: string): asserts v { if (!v) throw Error(`production_limit_${code}@src/limit-contract.ts:1`); }
const lex = (s: string) => [...s.matchAll(/"(?:\\.|[^"\\])*"|\\[A-Za-z]+|\\.|[^\s]/gs)];
const key = (s: string) => lex(s).map(t => t[0]).join(" ");
function groupEnd(tokens: RegExpMatchArray[], start: number) {
  need(tokens[start]?.[0] === "{", "braced_approach_required"); let depth = 0;
  for (let i = start; i < tokens.length; i++) {
    depth += +(tokens[i][0] === "{") - +(tokens[i][0] === "}");
    if (!depth) return i;
  }
  need(false, "unbalanced_approach");
}
export function analyzeLatexLimits(latex: string) {
  const tokens = lex(latex), results: (Omit<LimitApproach, "evidence"> & {start: number; end: number})[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (["\\text", "\\textrm", "\\operatorname"].includes(tokens[i][0]) && tokens[i+1]?.[0] === "{") { i = groupEnd(tokens,i+1); continue; }
    if (tokens[i][0] !== "\\lim") continue;
    let p = i+1; if (tokens[p]?.[0] === "\\limits") p++;
    need(tokens[p]?.[0] === "_", "approach_required");
    const end = groupEnd(tokens,p+1), begin = p+2; let depth = 0; const arrows: number[] = [];
    for (let n = begin; n < end; n++) {
      depth += +(tokens[n][0] === "{") - +(tokens[n][0] === "}");
      if (!depth && ["\\to", "\\rightarrow", "\\longrightarrow"].includes(tokens[n][0])) arrows.push(n);
    }
    need(arrows.length === 1, "single_approach_arrow_required"); const arrow = arrows[0];
    need(arrow > begin && arrow+1 < end, "variable_and_target_required");
    const start = tokens[arrow+1].index!, stop = tokens[end].index!;
    const variableLatex = latex.slice(tokens[begin].index!,tokens[arrow].index!).trim();
    const raw = latex.slice(start,stop).trim(); const t = lex(raw); let sign = "", cut = t.length, placement: LimitApproach["signPlacement"] = null;
    if (t.at(-1)?.[0] === "+" || t.at(-1)?.[0] === "-") {
      sign = t.at(-1)![0]; cut = t.length-1; placement = "baseline";
      if (t.at(-2)?.[0] === "^") { cut--; placement = "superscript"; }
    } else if (t.at(-1)?.[0] === "}" && ["+","-"].includes(t.at(-2)?.[0] ?? "") && t.at(-3)?.[0] === "{" && t.at(-4)?.[0] === "^") {
      sign = t.at(-2)![0]; cut = t.length-4; placement = "superscript";
    }
    need(cut > 0, "empty_target");
    const targetLatex = raw.slice(0,cut < t.length ? t[cut].index! : raw.length).trim();
    results.push({occurrence:results.length+1,variableLatex,targetLatex,direction:sign === "-" ? "left" : sign === "+" ? "right" : "two-sided",signPlacement:placement,start,end:stop});
  }
  return results;
}
/** Missing one-sided source annotations fail before conversion; never strip powers globally. */
export function applyLimitContract(latex: string, declarations: LimitApproach[] = []) {
  need(Array.isArray(declarations), "declarations");
  const found = analyzeLatexLimits(latex), seen = new Set<number>();
  for (const d of declarations) {
    need(d && Number.isSafeInteger(d.occurrence) && d.occurrence > 0 && d.occurrence <= found.length && !seen.has(d.occurrence), "declaration_binding"); seen.add(d.occurrence);
    need(typeof d.variableLatex === "string" && typeof d.targetLatex === "string" && typeof d.evidence === "string" && !!d.evidence.trim(), "source_evidence_required");
    const f = found[d.occurrence-1];
    need(key(d.variableLatex) === key(f.variableLatex) && key(d.targetLatex) === key(f.targetLatex) && d.direction === f.direction, "source_meaning_conflict");
    need(d.direction === "two-sided" ? d.signPlacement === null : ["baseline","superscript"].includes(d.signPlacement ?? ""), "sign_placement_required");
  }
  const edits: {offset:number;from:string;to:string}[] = [];
  const limitApproaches = found.map(f => {
    const d = declarations.find(d => d.occurrence === f.occurrence);
    need(f.direction === "two-sided" || d, "one_sided_source_annotation_required");
    if (d && d.signPlacement !== f.signPlacement) {
      const sign = d.direction === "left" ? "-" : "+";
      edits.push({offset:f.start,from:latex.slice(f.start,f.end),to:f.targetLatex+(d.signPlacement === "baseline" ? sign : `^{${sign}}`)});
    }
    const {start,end,...approach} = f;
    return d ?? {...approach,evidence:"Two-sided approach parsed from the pinned source transcription; no direction sign authored."};
  });
  let converterLatex = latex;
  for (let i=1;i<edits.length;i++) need(edits[i-1].offset+edits[i-1].from.length <= edits[i].offset, "overlapping_adaptations_require_review");
  for (const e of [...edits].reverse()) converterLatex = converterLatex.slice(0,e.offset)+e.to+converterLatex.slice(e.offset+e.from.length);
  return {converterLatex,limitApproaches,limitPresentationAdaptations:edits};
}
