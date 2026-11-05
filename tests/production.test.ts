import {expect,test} from 'bun:test';
import {admitSourceQuestion,adaptLatexPresentation,fitChoiceGrid,planSourceQuestion,wrapMeasuredAtoms} from '../src/production';
import {runProductionCli} from '../src/production-cli';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const sha='a'.repeat(64);
const settings={maxColumns:5,labelCellWidth:1694,equationOuterMargin:112,cellPadding:{left:120,right:120,top:300,bottom:300}};
function fixture():any{return {schema:'problem-edit.source-transcription.local.v1',questionId:'Q1',printedLabel:'1',section:'multiple-choice',source:{sha256:sha,physicalPage:1,logicalOrder:1,cropPath:'crops/Q1.png',cropSha256:'b'.repeat(64),xyxy:[0,0,.5,.5]},score:3,body:'Let {{E1}} and again {{E1}}.',paragraphs:['Let {{E1}} and again {{E1}}.'],math:[{id:'E1',latex:'x+1'}],statementBox:null,choices:[{number:1,kind:'math',latex:'1'},{number:2,kind:'text',text:'none'}],figureId:null,unresolved:[],contentOrder:[{kind:'paragraph',index:0},{kind:'choices'}]};}
test('compact packet preserves occurrences, typed choices and deterministic identity without approving anything',()=>{
 const a=planSourceQuestion(fixture(),sha),b=planSourceQuestion(fixture(),sha);
 expect(a).toEqual(b);expect(a.state).toBe('ready');expect(a.nativeHancomStatus).toBe('unknown');
 const first=a.blocks[0];if(first.kind!=='paragraph')throw Error('fixture');
 expect(first.atoms.filter(a=>a.kind==='equation').map(a=>a.occurrenceId)).toEqual(['Q1--E1--1','Q1--E1--2']);
 const q=fixture();q.unresolved=['unreadable denominator'];expect(planSourceQuestion(q,sha).state).toBe('interview-required');
});
test('admission rejects silent source changes, missing/unused math, malformed placeholders, omitted content and reordered prose',()=>{
 const bad=(edit:(q:any)=>void,code:string)=>{const q=fixture();edit(q);expect(()=>admitSourceQuestion(q,sha)).toThrow(code);};
 bad(q=>q.source.sha256='c'.repeat(64),'source_binding');
 bad(q=>q.source.cropPath='../outside.png','source_binding');
 bad(q=>q.source.xyxy=[0,0,0,.5],'crop_coordinates');
 bad(q=>q.math=[],'math_reference_coverage');bad(q=>q.math.push({id:'E2',latex:'y'}),'math_reference_coverage');
 bad(q=>q.math.push(q.math[0]),'duplicate_math_id');
 bad(q=>{q.body=q.paragraphs[0]='{{bad name}}';},'malformed_placeholder');
 bad(q=>q.paragraphs.push('missing from body'),'paragraph_body_sync');
 bad(q=>q.contentOrder.pop(),'complete_unique_content_order');
 bad(q=>q.contentOrder.push(q.contentOrder[0]),'complete_unique_content_order');
 bad(q=>q.choices.reverse(),'ordered_typed_choices');
 bad(q=>delete q.unresolved,'explicit_unresolved');
 bad(q=>{q.paragraphs=['one {{E1}}','two'];q.body=q.paragraphs.join('\n');q.contentOrder=[{kind:'paragraph',index:1},{kind:'paragraph',index:0},{kind:'choices'}];},'paragraph_reading_order');
});
test('source order can place a box between two paragraphs; labels and repeated equations are preserved',()=>{
 const q=fixture();q.paragraphs=['first {{E1}}','last {{E1}}'];q.body=q.paragraphs.join('\n');q.statementBox={title:null,labelStyle:'parenthesized',items:[{label:'a',body:'{{E1}}'}]};q.contentOrder=[{kind:'paragraph',index:0},{kind:'statement-box'},{kind:'paragraph',index:1},{kind:'choices'}];
 const p=planSourceQuestion(q,sha);expect(p.blocks.map(b=>b.kind)).toEqual(['paragraph','statement-box','paragraph','choices']);
 const box=p.blocks[1];if(box.kind!=='statement-box')throw Error('fixture');expect(box.items[0].label).toBe('(a)');
 const last=p.blocks[2];if(last.kind!=='paragraph'||last.atoms[1].kind!=='equation')throw Error('fixture');expect(last.atoms[1].occurrenceId).toBe('Q1--E1--3');
});
test('layout wraps only at admitted boundaries and fails instead of shrinking or losing oversized content',()=>{
 const a=(key:string,width:number,breakBefore=true,breakAfter=true)=>({key,width,breakBefore,breakAfter});
 expect(wrapMeasuredAtoms([a('a',4),a('eq',6),a('tail',3)],10)).toEqual([['a','eq'],['tail']]);
 expect(()=>wrapMeasuredAtoms([a('a',4),a('punct',2,false),a('b',4)],5)).toThrow('unsplittable_line_overflow');
 expect(()=>wrapMeasuredAtoms([a('eq',11)],10)).toThrow('unsplittable_line_overflow');
 expect(()=>wrapMeasuredAtoms([a('eq',1),a('eq',1)],10)).toThrow('measured_atoms');
});
test('choice grid uses stored object sizes plus padding, preserves order, reduces columns and rejects impossible fit',()=>{
 const items=Array.from({length:5},(_,i)=>({number:i+1,width:2000,height:i===2?2300:1100}));
 const five=fitChoiceGrid(items,47055,settings);expect(five.columns).toBe(5);expect(five.rows).toEqual([{numbers:[1,2,3,4,5],height:2900}]);
 const wide=items.map(c=>({...c,width:12000}));const reduced=fitChoiceGrid(wide,47055,settings);expect(reduced.columns).toBe(3);expect(reduced.rows.map(r=>r.numbers)).toEqual([[1,2,3],[4,5]]);
 expect(()=>fitChoiceGrid(items.map(c=>({...c,width:50000})),47055,settings)).toThrow('unsplittable_choice_overflow');
});
test('production CLI help is bounded and never writes or routes to a model',()=>{
 expect(runProductionCli(['help'])).toMatchObject({writes:false,nativeHancomStatus:'unknown'});
 expect(()=>runProductionCli(['help','extra'])).toThrow('argument');expect(()=>runProductionCli(['toString'])).toThrow('usage');expect(()=>runProductionCli(['packet','--file','x'])).toThrow('missing_source_sha');
});
test('contracts accept varying synthetic question identities, choice counts, symbolic math IDs and supplied settings',()=>{
 for(const count of [2,4,7,12]){
  const q=fixture();q.schema='problem-edit.source-question.v1';q.questionId='Q'+(20+count);q.printedLabel='Synthetic '+count;q.math=[{id:'expr_a',latex:'u+v'}];q.body=q.paragraphs[0]='{{expr_a}}';q.choices=Array.from({length:count},(_,i)=>({number:i+1,kind:'text',text:'option '+(i+1)}));
  expect(planSourceQuestion(q,sha).blocks.at(-1)?.kind).toBe('choices');
  const grid=fitChoiceGrid(q.choices.map((c:any)=>({number:c.number,width:5,height:4})),100,{maxColumns:2,labelCellWidth:4,equationOuterMargin:0,cellPadding:{left:0,right:0,top:1,bottom:2}});
  expect(grid.rows.flatMap(r=>r.numbers)).toEqual(q.choices.map((c:any)=>c.number));expect(grid.columns).toBe(2);
 }
 expect(()=>fitChoiceGrid([{number:1,width:1,height:1},{number:2,width:1,height:1}],100,undefined as any)).toThrow('choice_settings');
});
test('LaTeX spacing adaptation is exact, logged and idempotent without swallowing row separators or unknown commands',()=>{
 const source=String.raw`a,\quad b,\ c\qquad d\quadx\frac{1}{2}\\quad`;
 const p=adaptLatexPresentation(source);expect(p.converterLatex).toBe(String.raw`a,~ b,~c~ d\quadx\frac{1}{2}\\quad`);expect(p.presentationAdaptations.map(c=>c.from)).toEqual(['\\quad','\\ ','\\qquad']);expect(p.presentationAdaptations.every(c=>c.to==='~')).toBe(true);expect(adaptLatexPresentation(p.converterLatex).presentationAdaptations).toEqual([]);
});
test('explicitly unscored questions and literal source box labels do not acquire invented scores or punctuation',()=>{
 const q=fixture();q.score=null;q.statementBox={title:null,labelStyle:'literal',items:[{label:'A)',body:'{{E1}}'}]};q.contentOrder.splice(1,0,{kind:'statement-box'});
 const p=planSourceQuestion(q,sha);expect(p.score).toBeNull();const b=p.blocks[1];if(b.kind!=='statement-box')throw Error('fixture');expect(b.items[0].label).toBe('A)');delete q.score;expect(()=>admitSourceQuestion(q,sha)).toThrow('explicit_score_disposition');
});
test('packet CLI hashes actual bounded crop bytes and rejects changed files and symlink escapes',()=>{
 const root=mkdtempSync(join(tmpdir(),'production-contract-'));const outside=mkdtempSync(join(tmpdir(),'production-outside-'));
 try{
  const crop=join(root,'crop.png');writeFileSync(crop,'synthetic crop evidence');const q=fixture();q.source.cropPath='crop.png';q.source.cropSha256=createHash('sha256').update('synthetic crop evidence').digest('hex');const file=join(root,'source.json');writeFileSync(file,JSON.stringify(q));const args=['packet','--file',file,'--source-sha',sha,'--root',root];
  expect(runProductionCli(args)).toMatchObject({questionId:'Q1',state:'ready'});writeFileSync(crop,'changed');expect(()=>runProductionCli(args)).toThrow('source_crop_changed');
  const target=join(outside,'outside.png');writeFileSync(target,'outside');symlinkSync(target,join(root,'escape.png'));q.source.cropPath='escape.png';writeFileSync(file,JSON.stringify(q));expect(()=>runProductionCli(args)).toThrow('source_crop_outside_root');
 }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
