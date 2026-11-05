import {expect, test} from "bun:test";
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, symlinkSync, rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {prepareNativeBatch} from "../src/native-production";
import {planNativeLayout} from "../src/native-layout";
import {planSourceQuestion, type ProductionBlock} from "../src/production";
import {runProductionCli} from "../src/production-cli";
import {planProductionAudit} from "../src/production-audit";

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

test("compact audit routes only applicable mathematical scopes and binds exact source crop inputs",()=>{
 const root=mkdtempSync(join(tmpdir(),"production-audit-"));
 try{
  const f=fixture(root);f.source.math[1].latex=String.raw`\sqrt{a^2+b^2}`;f.job.questions=[f.save('question.json',f.source)];
  const p=planProductionAudit(prepareNativeBatch(f.job,root));
  expect(p.counts).toMatchObject({questions:1,equationTemplates:3,equationOccurrences:5,limitApproaches:0});
  expect(p.routes.map(r=>r.id).sort()).toEqual(['decorated-base-scope','radical-scope','scripts-and-arguments']);
  expect(p.sources[0]).toMatchObject({questionId:'Q37',crop:'crop.png'});expect(p.inputDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(p.sourceReviewRequired).toContain('actual printed source');
 }finally{rmSync(root,{recursive:true,force:true});}
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
  const spaced=structuredClone(batch);spaced.settings.lineSpacingPercent=150;
  expect(planNativeLayout(spaced).questions[0].blocks[0].rowHeights).toEqual([160,1360,160]);
  const bad=structuredClone(batch);bad.questions[0].blocks[0].items[0].content.atoms[0].height=100000;
  expect(()=>planNativeLayout(bad)).toThrow("question_overflow:Q9");
});

test("equation measurements bind source, script identity, actual SVG evidence and safe dimensions",()=>{
 const root=mkdtempSync(join(tmpdir(),"production-metrics-"));
 try{
  const f=fixture(root),svg=f.save("metric.svg",'<svg xmlns="http://www.w3.org/2000/svg"/>');
  const metrics={schema:"problem-edit.equation-measurements.v1",sourceSha256:f.job.sourcePdf.sha256,baseUnit:1100,entries:[{scriptSha256:"a".repeat(64),width:200,height:300,baselineHwpUnits:150,svg}]};
  const job:any={...f.job,equationMeasurements:f.save("metrics.json",metrics)};
  expect(prepareNativeBatch(job,root).equationMeasurements.entries[0].height).toBe(300);
  metrics.entries.push(metrics.entries[0]);job.equationMeasurements=f.save("metrics.json",metrics);expect(()=>prepareNativeBatch(job,root)).toThrow("duplicate_equation_measurement");
  metrics.entries.pop();metrics.entries[0].baselineHwpUnits=400;job.equationMeasurements=f.save("metrics.json",metrics);expect(()=>prepareNativeBatch(job,root)).toThrow("equation_measurement_dimensions");
  metrics.entries[0].baselineHwpUnits=150;job.equationMeasurements=f.save("metrics.json",metrics);writeFileSync(join(root,"metric.svg"),"changed");expect(()=>prepareNativeBatch(job,root)).toThrow("input_changed");
 }finally{rmSync(root,{recursive:true,force:true});}
});

test("declared header/footer space participates in whole-question packing",()=>{
 const q=(id:string)=>({questionId:id,blocks:[{kind:"paragraph",location:id,atoms:[{key:"a",width:1,height:700,breakBefore:true,breakAfter:true}]}]});
 const settings={paperMm:[100,10],pageMarginsMm:{top:0,bottom:0,header:3,footer:3},font:{points:1},equationBaseUnit:100,lineSpacingPercent:100,paragraphAfter:0,questionGap:0,contentWidth:100};
 const plan=planNativeLayout({settings,questions:[q("Q1"),q("Q2")]});expect(plan.plannedPages).toBe(2);expect(plan.questions[1].pageBreak).toBe(true);
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
    const record=JSON.parse(readFileSync(join(out,"composition.json"),"utf8"));expect(record.equations.every((e:any)=>e.script.endsWith("`"))).toBe(true);
    expect(record.images).toHaveLength(1);expect(record.equations.filter((e:any)=>e.script.includes("overline")).every((e:any)=>e.script.startsWith("{overline")&&e.script.includes("} ^"))).toBe(true);
    expect(record.tables.map((t:any)=>[t.kind,t.rows,t.columns])).toEqual([["statement-box",3,2],["box",1,1],["choices",1,4]]);
    expect(()=>runProductionCli(args)).toThrow("output_exists_use_new_version");
    const script=join(import.meta.dir,"native-production-check.py");
    const checked=Bun.spawnSync([process.env.PROBLEM_EDIT_NATIVE_PYTHON!,script,out],{stdout:"pipe",stderr:"pipe"});expect(checked.exitCode,checked.stderr.toString()).toBe(0);
    const inspected=runProductionCli(['inspect','--file',out,'--root',root,'--python',process.env.PROBLEM_EDIT_NATIVE_PYTHON!]) as any;
    expect(inspected.counts).toMatchObject({questions:1,equationOccurrences:5,nativeTables:3});expect(inspected.notCertified).toContain('Original PDF reading and all mathematical meaning');expect(inspected.native.status).toBe('unknown');
    const limitSource:any=structuredClone(f.source);limitSource.math[0]={id:"choice-1",latex:String.raw`\lim_{z\to b^{-}}z^2`,limitApproaches:[{occurrence:1,variableLatex:"z",targetLatex:"b",direction:"left",signPlacement:"baseline",evidence:"Synthetic printed baseline direction sign."}]};
    const limitJob:any={...f.job,questions:[f.save("limit-question.json",limitSource)]};const limitFile=f.save("limit-job.json",limitJob),limitOut=join(root,"native-limit-r1");
    runProductionCli(["compose","--file",join(root,limitFile.path),"--root",root,"--python",process.env.PROBLEM_EDIT_NATIVE_PYTHON!,"--out",limitOut]);
    const limitRecord=JSON.parse(readFileSync(join(limitOut,"composition.json"),"utf8"));expect(limitRecord.equations.filter((e:any)=>e.limitChecks.length).map((e:any)=>e.script)).toEqual(['lim _{z -> b -} z ^{2}`','lim _{z -> b -} z ^{2}`']);
    expect((runProductionCli(['inspect','--file',limitOut,'--root',root,'--python',process.env.PROBLEM_EDIT_NATIVE_PYTHON!]) as any).counts.equationOccurrences).toBe(5);
    const savedLimitCheck=Bun.spawnSync([process.env.PROBLEM_EDIT_NATIVE_PYTHON!,"-c",`import sys,json,hashlib,zipfile,xml.etree.ElementTree as E,importlib.util,tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('saved',sys.argv[2]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
r=Path(sys.argv[1]);record=json.loads((r/'composition.json').read_text());hp='{http://www.hancom.co.kr/hwpml/2011/paragraph}'
with zipfile.ZipFile(r/'document.hwpx') as z:data={n:z.read(n) for n in z.namelist()}
s=E.fromstring(data['Contents/section0.xml']);e=next(s.iter(hp+'equation'));e.find(hp+'script').text='lim _{z -> b ^{-}} z ^{2}'+chr(96);record['equations'][0]['script']=e.findtext(hp+'script');data['Contents/section0.xml']=E.tostring(s)
with tempfile.TemporaryDirectory() as t:
 p=Path(t)/'wrong.hwpx'
 with zipfile.ZipFile(p,'w') as z:
  for n,b in data.items():z.writestr(n,b)
 record['documentSha256']=hashlib.sha256(p.read_bytes()).hexdigest()
 try:m.inspect_saved(p,record)
 except ValueError as err:assert 'limit_meaning_and_sign_position' in str(err),str(err)
 else:raise AssertionError('self-consistent wrong superscript was accepted')
`,limitOut,join(import.meta.dir,"../packages/native-production/inspect_saved.py")],{stdout:"pipe",stderr:"pipe"});expect(savedLimitCheck.exitCode,savedLimitCheck.stderr.toString()).toBe(0);
    limitJob.equationOverrides=[{templateId:'Q37::body::choice-1',latex:limitSource.math[0].latex,script:'lim _{z -> b ^{-}} z ^{2}',reason:'Synthetic regression: source requests baseline.'}];const wrongLimitFile=f.save('wrong-limit-job.json',limitJob);
    expect(()=>runProductionCli(['compose','--file',join(root,wrongLimitFile.path),'--root',root,'--python',process.env.PROBLEM_EDIT_NATIVE_PYTHON!,'--out',join(root,'wrong-limit')])).toThrow('limit_semantics_or_sign_placement');expect(existsSync(join(root,'wrong-limit'))).toBe(false);
    const q2=structuredClone(f.source);q2.questionId="Q8";q2.printedLabel="8";q2.source.logicalOrder=1;
    q2.math.push({id:"piecewise",latex:String.raw`f(x)=\begin{cases}x&(x<0)\\-x&(x\geq0)\end{cases}`});
    q2.paragraphs.push("Tall final line {{piecewise}}. "+"After the equation ".repeat(8));q2.body=q2.paragraphs.join("\n");q2.contentOrder.push({kind:"paragraph",index:1} as any);
    const piecewiseScript="f ( x ) = cases {x & ( x < 0 ) # - x & ( x GEQ 0 )}`";
    const metrics=f.save("synthetic-metrics.json",{schema:"problem-edit.equation-measurements.v1",sourceSha256:f.job.sourcePdf.sha256,baseUnit:1100,entries:[{scriptSha256:hash(piecewiseScript),width:10000,height:5000,baselineHwpUnits:2500,svg:f.save("synthetic-metric.svg",'<svg xmlns="http://www.w3.org/2000/svg"/>')}]});
    const multi={...f.job,equationMeasurements:metrics,questions:[...f.job.questions,f.save("question2.json",q2)]};const file2=f.save("job2.json",multi);
    const result2=runProductionCli(["compose","--file",join(root,file2.path),"--root",root,"--python",process.env.PROBLEM_EDIT_NATIVE_PYTHON!,"--out",join(root,"native-multi-r1")]) as any;
    expect(result2.questions).toBe(2);expect(result2.equationOccurrences).toBe(11);expect(result2.nativeTables).toBe(7);
    const multiRecord=JSON.parse(readFileSync(join(root,"native-multi-r1/composition.json"),"utf8"));expect(multiRecord.questions).toEqual(["Q8","Q37"]);
    const containers=multiRecord.tables.filter((t:any)=>t.kind==="inline-equation-paragraph");expect(containers).toHaveLength(1);expect(containers[0].rows).toBeGreaterThan(1);expect(containers[0].columns).toBe(1);
    const containerCheck=Bun.spawnSync([process.env.PROBLEM_EDIT_NATIVE_PYTHON!,"-c",`import sys,zipfile,xml.etree.ElementTree as E
z=zipfile.ZipFile(sys.argv[1]);hp='{http://www.hancom.co.kr/hwpml/2011/paragraph}'
s=E.fromstring(z.read('Contents/section0.xml'))
t=next(t for t in s.iter(hp+'tbl') if 'Tall final line' in ''.join(e.text or '' for e in t.iter(hp+'t')))
c=t.find(hp+'tr/'+hp+'tc');eq=next(c.iter(hp+'equation'))
assert t.get('pageBreak')=='NONE' and int(c.find(hp+'cellSz').get('height'))>=int(eq.find(hp+'sz').get('height'))*1.45
assert c.find(hp+'subList').get('vertAlign')=='TOP'
`,join(root,"native-multi-r1/document.hwpx")],{stdout:"pipe",stderr:"pipe"});expect(containerCheck.exitCode,containerCheck.stderr.toString()).toBe(0);
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
