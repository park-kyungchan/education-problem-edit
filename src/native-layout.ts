/** Measured native-document plan; all typography/page constants are operation data. */
import {fitChoiceGrid, wrapMeasuredAtoms} from "./production";
import type {FilePin} from "./native-production";

export interface NativeLayoutSettings {
  profile: "reference-single-column";
  paperMm: [number, number];
  pageMarginsMm: {left: number; right: number; top: number; bottom: number; header?: number; footer?: number; gutter?: number};
  contentWidth: number;
  font: FilePin & {name: string; points: number};
  equationBaseUnit: number;
  lineSpacingPercent: number;
  paragraphAfter: number;
  blockGap: number;
  questionGap: number;
  measurementSafetyWidth: number;
  inlineEquationMargin: number;
  attachedPostpositions: string[];
  questionLabelSuffix: string;
  scorePrefix: string;
  scoreSuffix: string;
  choiceLabelPrefix: string;
  choiceLabelSuffix: string;
  choiceNumberStyle?: "decimal" | "circled";
  scoreDecimalPlaces?: number;
  box: {labelCellWidth: number; cellPadding: {left: number; right: number; top: number; bottom: number}};
  choice: import("./production").ChoiceLayoutSettings;
}

export function planNativeLayout(batch: any) {
  const s = batch.settings;
  function need(v: unknown, code: string): asserts v {if (!v) throw Error(`production_${code}@src/native-layout.ts:1`);}
  const paragraph = (p: any, width: number, spacing = s.lineSpacingPercent) => {
    try {
      p.lines = wrapMeasuredAtoms(p.atoms, width);
      p.lineHeights = p.lines.map((line: string[]) => Math.max(s.equationBaseUnit, s.font.points * 100, ...line.map(k => p.atoms.find((a: any) => a.key === k).height)) * spacing / 100 + s.paragraphAfter);
      p.height = p.lineHeights.reduce((a: number, b: number) => a + b, 0);
    } catch (e) {throw Error(`${String(e)} [${p.location}]`);}
    return p.height;
  };
  const available = Math.floor((s.paperMm[1] - s.pageMarginsMm.top - s.pageMarginsMm.bottom - (s.pageMarginsMm.header??0) - (s.pageMarginsMm.footer??0)) * 7200 / 25.4);
  let page = 1, used = 0;
  for (const q of batch.questions) {
    let height = 0;
    for (const b of q.blocks) {
      if (b.kind === "paragraph") height += paragraph(b, s.contentWidth);
      else if (b.kind === "figure") height += b.height + s.blockGap;
      else if (b.kind === "box" || b.kind === "statement-box") {
        const pad = s.box.cellPadding, inner = s.contentWidth - pad.left - pad.right;
        b.labelWidth = b.items.some((i: any) => i.label !== null) ? s.box.labelCellWidth : 0;
        b.rowHeights = [];
        if (b.title) b.rowHeights.push(paragraph(b.title, inner) + pad.top + pad.bottom);
        for (const item of b.items) {
          const h = paragraph(item.content, inner - b.labelWidth);
          const lh = item.label ? paragraph(item.label, b.labelWidth - pad.left - pad.right) : 0;
          b.rowHeights.push(Math.max(h, lh) + pad.top + pad.bottom);
        }
        b.height = b.rowHeights.reduce((a: number, b: number) => a + b, 0);
        height += b.height + s.blockGap;
      } else if (b.kind === "choices") {
        const sizes = b.items.map((i: any) => ({number: i.number, width: i.content.atoms.reduce((n: number, a: any) => n + a.width, 0), height: Math.max(...i.content.atoms.map((a: any) => a.height))}));
        b.grid = fitChoiceGrid(sizes, s.contentWidth, s.choice);
        // Labels have their own measured cells; never assume a circled glyph will fit.
        for (const i of b.items) {
          paragraph(i.label, b.grid.labelCellWidth - s.choice.cellPadding.left - s.choice.cellPadding.right, 100);
          paragraph(i.content, b.grid.contentCellWidth - s.choice.cellPadding.left - s.choice.cellPadding.right, 100);
        }
        for (const row of b.grid.rows) row.height = Math.max(...row.numbers.flatMap((n: number) => {const i = b.items.find((i: any) => i.number === n); return [i.label.height, i.content.height];})) + s.choice.cellPadding.top + s.choice.cellPadding.bottom;
        height += b.grid.rows.reduce((n: number, r: any) => n + r.height + s.blockGap, 0);
      } else need(false, "layout_block");
    }
    height += s.questionGap;
    need(height <= available, `question_overflow:${q.questionId}`);
    q.pageBreak = used > 0 && used + height > available;
    if (q.pageBreak) {page++; used = 0;}
    q.plannedPage = page; q.estimatedHeight = height; used += height;
  }
  return {...batch, schema: "problem-edit.native-layout.v1", plannedPages: page, measurementStatus: "estimate-requires-independent-render"};
}
