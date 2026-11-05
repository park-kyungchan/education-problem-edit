/** Deterministic production admission and layout decisions. No model calls or file writes. */
export interface SourceQuestion {
  schema: "problem-edit.source-question.v1" | "problem-edit.source-transcription.local.v1";
  questionId: string; printedLabel: string; section: "multiple-choice" | "constructed-response";
  source: { sha256: string; physicalPage: number; logicalOrder: number; cropPath: string; cropSha256: string; xyxy: number[] };
  score: number | null; body?: string; math: {id: string; latex: string}[]; paragraphs: string[];
  statementBox: null | {title: string | null; labelStyle: "parenthesized" | "consonant-with-period" | "literal"; items: {label: string; body: string}[]};
  choices: ({number: number; kind: "math"; latex: string} | {number: number; kind: "text"; text: string})[];
  figureId: string | null; unresolved: string[];
  boxes?: {id: string; title: string | null; items: {label: string | null; body: string}[]}[];
  contentOrder: ({kind: "paragraph"; index: number} | {kind: "statement-box"} | {kind: "box"; id: string} | {kind: "figure"; id: string} | {kind: "choices"})[];
}
export type Atom = {kind: "text"; text: string} | {kind: "equation"; itemId: string; occurrenceId: string; latex: string; converterLatex:string; presentationAdaptations:{offset:number;from:string;to:string}[]};
export type ProductionBlock = {kind: "paragraph"; index: number; atoms: Atom[]} | {kind: "statement-box" | "box"; id: string; title: string | null; titleAtoms: Atom[]; nativeTableRequired: true; items: {label: string | null; atoms: Atom[]}[]} | {kind: "figure"; id: string} | {kind: "choices"; items: {number: number; atoms: Atom[]}[]};
const obj=(v:unknown):v is Record<string,any>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==="string"&&!!v.trim()&&v.isWellFormed();
const hash=(v:unknown)=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
function need(ok:unknown,code:string):asserts ok {if(!ok)throw Error(`production_${code}@src/production.ts:1`);}
const safePath=(v:unknown)=>text(v)&&!v.startsWith("/")&&!v.includes("\\")&&!v.split("/").some(p=>p===".."||p==="."||!p);
export function admitSourceQuestion(raw:unknown,expectedSourceSha256:string):SourceQuestion {
 need(hash(expectedSourceSha256),"expected_source_hash");
 need(obj(raw)&&["problem-edit.source-question.v1","problem-edit.source-transcription.local.v1"].includes(raw.schema),"source_schema");
 need(text(raw.questionId)&&/^Q[1-9]\d*$/.test(raw.questionId)&&text(raw.printedLabel),"question_identity");
 need(["multiple-choice","constructed-response"].includes(raw.section),"section");
 const s=raw.source;need(obj(s)&&s.sha256===expectedSourceSha256&&hash(s.cropSha256)&&safePath(s.cropPath),"source_binding");
 need(Number.isSafeInteger(s.physicalPage)&&s.physicalPage>0&&Number.isSafeInteger(s.logicalOrder)&&s.logicalOrder>0,"source_order");
 need(Array.isArray(s.xyxy)&&s.xyxy.length===4&&s.xyxy.every((n:unknown)=>typeof n==="number"&&Number.isFinite(n))&&s.xyxy[0]>=0&&s.xyxy[1]>=0&&s.xyxy[0]<s.xyxy[2]&&s.xyxy[1]<s.xyxy[3]&&s.xyxy[2]<=1&&s.xyxy[3]<=1,"crop_coordinates");
 need(raw.score===null||(typeof raw.score==="number"&&Number.isFinite(raw.score)&&raw.score>=0),"explicit_score_disposition");
 need(Array.isArray(raw.paragraphs)&&raw.paragraphs.length>0&&raw.paragraphs.every(text)&&(raw.body===raw.paragraphs.join("\n")||(raw.schema==="problem-edit.source-question.v1"&&raw.body===undefined)),"paragraph_body_sync");
 need(Array.isArray(raw.math)&&raw.math.every((e:unknown)=>obj(e)&&text(e.id)&&/^[A-Za-z][A-Za-z0-9_-]*$/.test(e.id)&&text(e.latex)),"math_definition");
 need(new Set(raw.math.map((e:any)=>e.id)).size===raw.math.length,"duplicate_math_id");
 need(raw.figureId===null||text(raw.figureId),"figure_disposition");
 need(Array.isArray(raw.unresolved)&&raw.unresolved.every(text),"explicit_unresolved");
 need(Array.isArray(raw.choices)&&raw.choices.every((c:unknown,i:number)=>obj(c)&&c.number===i+1&&((c.kind==="math"&&text(c.latex))||(c.kind==="text"&&text(c.text)))),"ordered_typed_choices");
 need(raw.section==="multiple-choice"?raw.choices.length>=2:raw.choices.length===0,"section_choices");
 const b=raw.statementBox;
 need(b===null||(obj(b)&&(b.title===null||text(b.title))&&["parenthesized","consonant-with-period","literal"].includes(b.labelStyle)&&Array.isArray(b.items)&&b.items.length>0&&b.items.every((i:unknown)=>obj(i)&&text(i.label)&&text(i.body))),"statement_box");
 if(b)need(new Set(b.items.map((i:any)=>i.label)).size===b.items.length,"duplicate_statement_label");
 const boxes=raw.boxes??[];
 need(Array.isArray(boxes)&&boxes.every((x:unknown)=>obj(x)&&text(x.id)&&(x.title===null||text(x.title))&&Array.isArray(x.items)&&x.items.length>0&&x.items.every((i:unknown)=>obj(i)&&(i.label===null||text(i.label))&&text(i.body))),"boxes");
 need(new Set(boxes.map((x:any)=>x.id)).size===boxes.length,"duplicate_box_id");
 need(Array.isArray(raw.contentOrder)&&raw.contentOrder.length>0,"explicit_content_order");
 const expected=[...raw.paragraphs.map((_:unknown,i:number)=>`paragraph:${i}`),...(b?["statement-box"]:[]),...boxes.map((x:any)=>"box:"+x.id),...(raw.figureId?["figure:"+raw.figureId]:[]),...(raw.choices.length?["choices"]:[])];
 const actual=raw.contentOrder.map((v:unknown)=>{need(obj(v),"content_block");switch(v.kind){case "paragraph":need(Number.isSafeInteger(v.index)&&v.index>=0,"paragraph_index");return `paragraph:${v.index}`;case "box":case "figure":need(text(v.id),"content_id");return v.kind+":"+v.id;case "statement-box":case "choices":return v.kind;default:need(false,"unsupported_content_block");}});
 need(actual.length===expected.length&&new Set(actual).size===actual.length&&expected.every(k=>actual.includes(k)),"complete_unique_content_order");
 need(actual.filter(k=>k.startsWith("paragraph:")).join()===expected.filter(k=>k.startsWith("paragraph:")).join(),"paragraph_reading_order");
 // Reject dangling, unused and malformed placeholders; never guess source content.
 const prose=[...raw.paragraphs,...(b?[b.title??"",...b.items.map((i:any)=>i.body)]:[]),...boxes.flatMap((x:any)=>[x.title??"",...x.items.map((i:any)=>i.body)])].join("\n");
 const refs=[...prose.matchAll(/\{\{([A-Za-z][A-Za-z0-9_-]*)\}\}/g)].map(m=>m[1]);
 need(!prose.replace(/\{\{[A-Za-z][A-Za-z0-9_-]*\}\}/g,"").match(/\{\{|\}\}/),"malformed_placeholder");
 need(refs.every(id=>raw.math.some((e:any)=>e.id===id))&&raw.math.every((e:any)=>refs.includes(e.id)),"math_reference_coverage");
 return {...raw,body:raw.paragraphs.join("\n")} as unknown as SourceQuestion;
}
export interface ChoiceLayoutSettings {maxColumns:number;labelCellWidth:number;equationOuterMargin:number;cellPadding:{left:number;right:number;top:number;bottom:number};}
/** Only admitted spacing tokens; preserve commands, row separators and original source. */
export function adaptLatexPresentation(latex:string){
 const changes:{offset:number;from:string;to:string}[]=[];
 const converterLatex=latex.replace(/\\(?:[A-Za-z]+|.)/gs,(token,offset)=>{
  if(!['\\quad','\\qquad','\\ '].includes(token))return token;
  changes.push({offset,from:token,to:'~'});return '~';
 });return {converterLatex,presentationAdaptations:changes};
}
export function planSourceQuestion(raw:unknown,expectedSourceSha256:string){
 const q=admitSourceQuestion(raw,expectedSourceSha256),counts=new Map<string,number>();
 const atoms=(s:string):Atom[]=>s.split(/(\{\{[A-Za-z][A-Za-z0-9_-]*\}\})/g).filter(Boolean).map(p=>{
  if(!p.startsWith("{{"))return {kind:"text",text:p};
  const id=p.slice(2,-2),e=q.math.find(e=>e.id===id)!,n=(counts.get(id)??0)+1;counts.set(id,n);
  return {kind:"equation",itemId:id,occurrenceId:`${q.questionId}--${id}--${n}`,latex:e.latex,...adaptLatexPresentation(e.latex)};
 });
 const blocks:ProductionBlock[]=q.contentOrder.map(b=>{
  switch(b.kind){case "paragraph":return {...b,atoms:atoms(q.paragraphs[b.index])};
   case "statement-box":return {kind:b.kind,id:"statement-box",title:q.statementBox!.title,titleAtoms:q.statementBox!.title?atoms(q.statementBox!.title):[],nativeTableRequired:true,items:q.statementBox!.items.map(i=>({label:q.statementBox!.labelStyle==="parenthesized"?`(${i.label})`:q.statementBox!.labelStyle==="consonant-with-period"?`${i.label}.`:i.label,atoms:atoms(i.body)}))};
   case "box":{const box=q.boxes!.find(x=>x.id===b.id)!;return {kind:b.kind,id:box.id,title:box.title,titleAtoms:box.title?atoms(box.title):[],nativeTableRequired:true,items:box.items.map(i=>({label:i.label,atoms:atoms(i.body)}))};}
   case "figure":return b;
   case "choices":return {kind:b.kind,items:q.choices.map(c=>({number:c.number,atoms:c.kind==="text"?[{kind:"text",text:c.text}]:[{kind:"equation",itemId:`choice-${c.number}`,occurrenceId:`${q.questionId}--choice:${c.number}--1`,latex:c.latex,...adaptLatexPresentation(c.latex)}]}))};}
 });
 return {schema:"problem-edit.production-packet.v1",questionId:q.questionId,printedLabel:q.printedLabel,section:q.section,score:q.score,source:q.source,state:q.unresolved.length?"interview-required":"ready",holds:q.unresolved,blocks,layoutSettingsRequired:true,equationTerminalToken:"~",nativeHancomStatus:"unknown",answerKeyInferred:false};
}
export interface MeasuredAtom {key:string; width:number; breakBefore:boolean; breakAfter:boolean;}
/** Greedy whole-equation wrapping; the measurer supplies legal punctuation/word boundaries. */
export function wrapMeasuredAtoms(atoms:MeasuredAtom[],width:number):string[][]{
 need(Number.isFinite(width)&&width>0,"line_width");
 need(atoms.length>0&&atoms.every(a=>text(a.key)&&Number.isFinite(a.width)&&a.width>=0&&typeof a.breakBefore==="boolean"&&typeof a.breakAfter==="boolean")&&new Set(atoms.map(a=>a.key)).size===atoms.length,"measured_atoms");
 const lines:string[][]=[];let start=0;
 while(start<atoms.length){let end=start,sum=0,last=-1;
  while(end<atoms.length&&sum+atoms[end].width<=width){sum+=atoms[end].width;end++;if(end===atoms.length||(atoms[end-1].breakAfter&&atoms[end].breakBefore))last=end;}
  if(end===atoms.length)last=end;
  need(last>start,"unsplittable_line_overflow");lines.push(atoms.slice(start,last).map(a=>a.key));start=last;
 }
 return lines;
}
export function fitChoiceGrid(items:{number:number;width:number;height:number}[],width:number,r:ChoiceLayoutSettings){
 need(!!r&&Number.isSafeInteger(r.maxColumns)&&r.maxColumns>0&&Number.isFinite(r.labelCellWidth)&&r.labelCellWidth>0&&Number.isFinite(r.equationOuterMargin)&&r.equationOuterMargin>=0&&!!r.cellPadding&&['left','right','top','bottom'].every(k=>Number.isFinite(r.cellPadding[k as keyof typeof r.cellPadding])&&r.cellPadding[k as keyof typeof r.cellPadding]>=0),"choice_settings");
 need(items.length>=2&&items.every((c,i)=>c.number===i+1&&Number.isFinite(c.width)&&c.width>=0&&Number.isFinite(c.height)&&c.height>0)&&Number.isFinite(width)&&width>0,"choice_measurements");
 const pad=r.cellPadding;
 let columns=Math.min(r.maxColumns,items.length);
 while(columns>0){const contentWidth=Math.floor(width/columns)-r.labelCellWidth;
  if(items.every(c=>c.width+pad.left+pad.right+r.equationOuterMargin<=contentWidth))break;columns--;}
 need(columns>0,"unsplittable_choice_overflow");
 const rows=[];for(let i=0;i<items.length;i+=columns){const batch=items.slice(i,i+columns);rows.push({numbers:batch.map(c=>c.number),height:Math.max(...batch.map(c=>c.height))+pad.top+pad.bottom});}
 return {columns,labelCellWidth:r.labelCellWidth,contentCellWidth:Math.floor(width/columns)-r.labelCellWidth,rows};
}
