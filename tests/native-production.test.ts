import {expect, test} from "bun:test";
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, symlinkSync, rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {prepareNativeBatch} from "../src/native-production";
import {planNativeLayout} from "../src/native-layout";
import {planSourceQuestion, type ProductionBlock} from "../src/production";
import {runProductionCli} from "../src/production-cli";

const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
function fixture(root: string, font?: string) {
  const save = (name: string, value: any) => {const data = typeof value === "string" ? value : JSON.stringify(value); writeFileSync(join(root,name),data); return {path:name,sha256:hash(data)};};
  const pdf = save("source.pdf", "%PDF-synthetic evidence only");
  const crop = save("crop.png", "synthetic crop binding");
  if (font) copyFileSync(font, join(root,"font.otf")); else save("font.otf", "synthetic font pin");
  const source = {schema:"problem-edit.source-question.v1",questionId:"Q37",printedLabel:"37",section:"multiple-choice",source:{sha256:pdf.sha256,physicalPage:2,logicalOrder:3,cropPath:crop.path,cropSha256:crop.sha256,xyxy:[0,0,1,1]},score:null,
    body:"Find {{choice-1}} and {{choice-1}}.",paragraphs:["Find {{choice-1}} and {{choice-1}}."],math:[{id:"choice-1",latex:String.raw`\overline{\mathrm{AB}}^2`},{id:"fraction",latex:String.raw`\frac{1}{2}`}],statementBox:{title:"보기",labelStyle:"literal",items:[{label:"A)",body:"{{fraction}} is given."},{label:"B)",body:"Another row."}]},
    boxes:[{id:"conditions",title:null,items:[{label:null,body:"A separate condition with {{fraction}}."}]}],choices:[{number:1,kind:"math",latex:"x+1"},{number:2,kind:"text",text:"No such value"}],figureId:null,unresolved:[] as string[],
    contentOrder:[{kind:"paragraph",index:0},{kind:"statement-box"},{kind:"box",id:"conditions"},{kind:"choices"}]};
  const settings={profile:"reference-single-column",paperMm:[210,297],pageMarginsMm:{left:22,right:22,top:17,bottom:17},contentWidth:47055,
    font:{name:"Noto Sans CJK KR",path:"font.otf",sha256:hash(readFileSync(join(root,"font.otf"))),points:11},equationBaseUnit:1100,lineSpacingPercent:145,paragraphAfter:300,blockGap:700,questionGap:1000,
    measurementSafetyWidth:40,inlineEquationMargin:100,attachedPostpositions:["가","의","는"],questionLabelSuffix:". ",scorePrefix:" [",scoreSuffix:"점]",choiceLabelPrefix:"",choiceLabelSuffix:")",
    box:{labelCellWidth:2600,cellPadding:{left:160,right:160,top:240,bottom:240}},choice:{maxColumns:4,labelCellWidth:2200,equationOuterMargin:100,cellPadding:{left:120,right:120,top:200,bottom:200}}};
  const questionPin=save("question.json",source),settingsPin=save("settings.json",settings);
  const job={schema:"problem-edit.composition-job.v1",sourcePdf:pdf,questions:[questionPin],settings:settingsPin,figures:[] as {id:string;png:{path:string;sha256:string};svg:{path:string;sha256:string};width:number}[]};
  return {source,settings,job,save};
}

test("batch preparation binds actual files, sorts arbitrary selection and generates pending seeds and unique equation templates",()=>{
  const root=mkdtempSync(join(tmpdir(),"production-batch-"));
  try{
    const f=fixture(root); const q2=structuredClone(f.source);q2.questionId="Q4";q2.source.logicalOrder=1;q2.printedLabel="4";
    f.job.questions.push(f.save("question2.json",q2));
    const b=prepareNativeBatch(f.job,root);
    expect(b.packets.map((q:any)=>q.questionId)).toEqual(["Q4","Q37"]);
    expect(b.templates).toHaveLength(6);expect(b.unitSeeds.every((u:any)=>u.stages.every((s:any)=>s.state==="pending"))).toBe(true);
    expect(b.humanAcceptance).toBe("not-granted");expect(b.nativeHancomStatus).toBe("unknown");
    const all=(q:any)=>q.blocks.flatMap((b:any)=>b.atoms??[...(b.titleAtoms??[]),...(b.items??[]).flatMap((i:any)=>i.atoms)]).filter((a:any)=>a.kind==="equation");
    const atoms=b.packets.flatMap(all);expect(new Set(atoms.map((a:any)=>a.occurrenceId)).size).toBe(atoms.length);
    expect(new Set(atoms.map((a:any)=>a.templateId)).size).toBe(6);
    f.job.questions.push(f.job.questions[0]);expect(()=>prepareNativeBatch(f.job,root)).toThrow("duplicate_question");
  } finally {rmSync(root,{recursive:true,force:true});}
});

test("all box rows/titles remain ordered native-table blocks, with no invented label or title punctuation",()=>{
  const root=mkdtempSync(join(tmpdir(),"production-boxes-"));
  try{
    const f=fixture(root);const p=planSourceQuestion(f.source,f.job.sourcePdf.sha256);
    expect(p.blocks.map(b=>b.kind)).toEqual(["paragraph","statement-box","box","choices"]);
    const boxes=p.blocks.filter((b):b is Extract<ProductionBlock,{kind:"statement-box"|"box"}>=>b.kind==="statement-box"||b.kind==="box");
    expect(boxes.map(b=>b.nativeTableRequired)).toEqual([true,true]);expect(boxes[0].titleAtoms).toEqual([{kind:"text",text:"보기"}]);expect(boxes[1].items[0].label).toBeNull();
    const bad=structuredClone(f.source);bad.contentOrder.splice(2,1);expect(()=>planSourceQuestion(bad,f.job.sourcePdf.sha256)).toThrow("complete_unique_content_order");
    const title=structuredClone(f.source);title.statementBox.title="보기 {{fraction}}";expect(planSourceQuestion(title,f.job.sourcePdf.sha256).blocks[1].kind).toBe("statement-box");
  } finally {rmSync(root,{recursive:true,force:true});}
});

test("canonical source derives redundant body text, retains an explicit zero score and still rejects conflicting supplied body",()=>{
  const root=mkdtempSync(join(tmpdir(),"production-body-"));
  try{
    const f=fixture(root);const q:any=structuredClone(f.source);delete q.body;q.score=0;
    expect(planSourceQuestion(q,f.job.sourcePdf.sha256).score).toBe(0);
    q.body="different source content";expect(()=>planSourceQuestion(q,f.job.sourcePdf.sha256)).toThrow("paragraph_body_sync");
  } finally {rmSync(root,{recursive:true,force:true});}
});

test("batch rejects changed bytes, missing figure coverage, stale overrides and linked inputs; holds block compose before execution",()=>{
  const root=mkdtempSync(join(tmpdir(),"production-inputs-")),outside=mkdtempSync(join(tmpdir(),"production-external-"));
  try{
    const f=fixture(root);writeFileSync(join(root,"source.pdf"),"changed");expect(()=>prepareNativeBatch(f.job,root)).toThrow("input_changed");
    const g=fixture(root);g.source.unresolved=["unreadable denominator"];g.job.questions=[g.save("question.json",g.source)];const job=g.save("job.json",g.job);
    expect(prepareNativeBatch(g.job,root).holds).toEqual([{questionId:"Q37",issue:"unreadable denominator"}]);
    expect(()=>runProductionCli(["compose","--file",join(root,job.path),"--root",root,"--python","/nonexistent","--out",join(root,"out")])).toThrow("source_interview_required");expect(existsSync(join(root,"out"))).toBe(false);
    const k=fixture(root);(k.job as any).equationOverrides=[{templateId:"Q37::body::choice-1",latex:"wrong",script:"x",reason:"test"}];expect(()=>prepareNativeBatch(k.job,root)).toThrow("equation_override_binding");
    writeFileSync(join(outside,"source.pdf"),"%PDF-synthetic evidence only");symlinkSync(join(outside,"source.pdf"),join(root,"link.pdf"));k.job.sourcePdf.path="link.pdf";expect(()=>prepareNativeBatch(k.job,root)).toThrow("input_outside_root");
  } finally {rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

test("measured native layout sizes every box row dynamically and fails oversized whole questions without truncation",()=>{
  const atom=(key:string,width:number,height:number)=>({key,width,height,breakBefore:true,breakAfter:true});
  const p=(location:string,height:number)=>({location,atoms:[atom("a",20,height)]});
  const s={paperMm:[100,100],pageMarginsMm:{top:5,bottom:5},contentWidth:2000,font:{points:1},equationBaseUnit:100,lineSpacingPercent:100,paragraphAfter:0,blockGap:20,questionGap:20,box:{labelCellWidth:300,cellPadding:{left:10,right:10,top:5,bottom:5}}};
  const batch={settings:s,questions:[{questionId:"Q9",blocks:[{kind:"box",title:p("title",100),items:[{label:p("label",100),content:p("tall fraction",900)},{label:null,content:p("short",100)}]}]}]};
  const plan=planNativeLayout(structuredClone(batch));expect(plan.questions[0].blocks[0].rowHeights).toEqual([110,910,110]);
  const bad=structuredClone(batch);bad.questions[0].blocks[0].items[0].content.atoms[0].height=100000;
  expect(()=>planNativeLayout(bad)).toThrow("question_overflow:Q9");
});

test.skipIf(!process.env.PROBLEM_EDIT_NATIVE_PYTHON || !process.env.PROBLEM_EDIT_NATIVE_FONT)("native composer emits actual table cells and terminal-spaced equation occurrences; saved mutations and output replay are rejected",()=>{
  const root=process.env.PROBLEM_EDIT_NATIVE_TEST_ROOT ?? mkdtempSync(join(tmpdir(),"production-native-"));mkdirSync(root,{recursive:true});
  const persist=!!process.env.PROBLEM_EDIT_NATIVE_TEST_ROOT;
  try{
    const f=fixture(root,process.env.PROBLEM_EDIT_NATIVE_FONT);
    const png=join(root,"figure.png");
    const made=Bun.spawnSync([process.env.PROBLEM_EDIT_NATIVE_PYTHON!,"-c","from PIL import Image, ImageDraw; import sys; im=Image.new('RGB',(100,100),'white'); ImageDraw.Draw(im).rectangle((30,30,70,70),fill='black'); im.save(sys.argv[1])",png],{stdout:"pipe",stderr:"pipe"});expect(made.exitCode).toBe(0);
    const svg=f.save("figure.svg",'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect x="30" y="30" width="40" height="40"/></svg>');
    (f.source as any).figureId="synthetic-figure";f.source.contentOrder.splice(3,0,{kind:"figure",id:"synthetic-figure"} as any);f.job.questions=[f.save("question.json",f.source)];
    f.job.figures=[{id:"synthetic-figure",png:{path:"figure.png",sha256:hash(readFileSync(png))},svg,width:3000}];
    const file=f.save("job.json",f.job);const out=join(root,"native-r1");
    const args=["compose","--file",join(root,file.path),"--root",root,"--python",process.env.PROBLEM_EDIT_NATIVE_PYTHON!,"--out",out];
    const result=runProductionCli(args) as any;expect(result.questions).toBe(1);expect(result.equationOccurrences).toBe(5);expect(result.nativeTables).toBe(3);expect(result.nativeHancomStatus).toBe("unknown");
    const record=JSON.parse(readFileSync(join(out,"composition.json"),"utf8"));expect(record.equations.every((e:any)=>e.script.endsWith("~"))).toBe(true);
    expect(record.images).toHaveLength(1);expect(record.equations.filter((e:any)=>e.script.includes("overline")).every((e:any)=>e.script.startsWith("{overline")&&e.script.includes("} ^"))).toBe(true);
    expect(record.tables.map((t:any)=>[t.kind,t.rows,t.columns])).toEqual([["statement-box",3,2],["box",1,1],["choices",1,4]]);
    expect(()=>runProductionCli(args)).toThrow("output_exists_use_new_version");
    const script=join(import.meta.dir,"native-production-check.py");
    const checked=Bun.spawnSync([process.env.PROBLEM_EDIT_NATIVE_PYTHON!,script,out],{stdout:"pipe",stderr:"pipe"});expect(checked.exitCode,checked.stderr.toString()).toBe(0);
    const q2=structuredClone(f.source);q2.questionId="Q8";q2.printedLabel="8";q2.source.logicalOrder=1;
    const multi={...f.job,questions:[...f.job.questions,f.save("question2.json",q2)]};const file2=f.save("job2.json",multi);
    const result2=runProductionCli(["compose","--file",join(root,file2.path),"--root",root,"--python",process.env.PROBLEM_EDIT_NATIVE_PYTHON!,"--out",join(root,"native-multi-r1")]) as any;
    expect(result2.questions).toBe(2);expect(result2.equationOccurrences).toBe(10);expect(result2.nativeTables).toBe(6);
    const multiRecord=JSON.parse(readFileSync(join(root,"native-multi-r1/composition.json"),"utf8"));expect(multiRecord.questions).toEqual(["Q8","Q37"]);
    const badSettings:any=structuredClone(f.settings);badSettings.box.cellPadding.left=true;
    const badJob={...f.job,settings:f.save("bad-settings.json",badSettings)};const badFile=f.save("bad-job.json",badJob);
    expect(()=>runProductionCli(["compose","--file",join(root,badFile.path),"--root",root,"--python",process.env.PROBLEM_EDIT_NATIVE_PYTHON!,"--out",join(root,"invalid-margins")])).toThrow("box_padding");
    expect(existsSync(join(root,"invalid-margins"))).toBe(false);
    const outside=mkdtempSync(join(tmpdir(),"native-output-external-"));
    try{
      symlinkSync(outside,join(root,"external-output"));
      expect(()=>runProductionCli(["compose","--file",join(root,file.path),"--root",root,"--python",process.env.PROBLEM_EDIT_NATIVE_PYTHON!,"--out",join(root,"external-output/escape")])).toThrow("output_outside_root");
      expect(existsSync(join(outside,"escape"))).toBe(false);
    } finally {rmSync(outside,{recursive:true,force:true});}
  } finally {if(!persist)rmSync(root,{recursive:true,force:true});}
},180000);
