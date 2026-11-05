import {expect,test} from "bun:test";
import {analyzeLatexLimits,applyLimitContract,type LimitApproach} from "../src/limit-contract";
import {planSourceQuestion} from "../src/production";
const decl=(targetLatex:string,direction:LimitApproach['direction'],signPlacement:LimitApproach['signPlacement'],occurrence=1,variableLatex="u"):LimitApproach=>({occurrence,variableLatex,targetLatex,direction,signPlacement,evidence:"Synthetic printed source: direction sign is on the declared line."});
test("one-sided direction requires explicit source evidence and adapts only its sign position",()=>{
 const s=String.raw`\lim_{u\to-3^{-}}u^2+\lim_{u\to a^2+}u^{-1}`;
 expect(()=>applyLimitContract(s)).toThrow("one_sided_source_annotation_required");
 const p=applyLimitContract(s,[decl('-3','left','baseline'),decl('a^2','right','baseline',2)]);
 expect(p.converterLatex).toBe(String.raw`\lim_{u\to-3-}u^2+\lim_{u\to a^2+}u^{-1}`);
 expect(p.limitApproaches.map(x=>x.direction)).toEqual(['left','right']);expect(p.limitPresentationAdaptations).toHaveLength(1);
 expect(applyLimitContract(p.converterLatex,p.limitApproaches).limitPresentationAdaptations).toEqual([]);
 expect(()=>applyLimitContract(s,[decl('-3','right','baseline'),decl('a^2','right','baseline',2)])).toThrow('source_meaning_conflict');
});
test("signed endpoints and actual exponents remain two-sided; nested targets and source superscripts are preserved",()=>{
 const s=String.raw`\lim_{x\to-2}x^{-2}+\lim_{t\to-\infty}t^2+\lim_{x\to a^{-1}}f(x)`;
 const p=applyLimitContract(s);expect(p.converterLatex).toBe(s);expect(p.limitApproaches.map(x=>x.direction)).toEqual(['two-sided','two-sided','two-sided']);
 const n=String.raw`\lim\limits_{u\rightarrow\frac{a}{b}^{+}}u`;
 expect(applyLimitContract(n,[decl(String.raw`\frac{a}{b}`,'right','baseline')]).converterLatex).toBe(String.raw`\lim\limits_{u\rightarrow\frac{a}{b}+}u`);
 const raised=applyLimitContract(String.raw`\lim_{u\to c-}f(u)`,[decl('c','left','superscript')]);expect(raised.converterLatex).toBe(String.raw`\lim_{u\to c^{-}}f(u)`);
 expect(analyzeLatexLimits(String.raw`\text{\lim_{u\to3^+}}+"\lim_{u\to3^-}"`)).toEqual([]);
});
test("limit declarations reject stale bindings, unsupported syntax and missing evidence rather than guessing",()=>{
 const s=String.raw`\lim_{u\to b^+}u`;
 for(const d of [{...decl('b','right','baseline'),evidence:''},{...decl('b','right','baseline'),occurrence:2},decl('c','right','baseline'),{...decl('b','right','baseline'),signPlacement:null}])expect(()=>applyLimitContract(s,[d as LimitApproach])).toThrow();
 expect(()=>applyLimitContract(String.raw`\lim_{u=b}u`)).toThrow('single_approach_arrow_required');
 expect(()=>applyLimitContract(String.raw`\lim_u u`)).toThrow('braced_approach_required');
 expect(()=>applyLimitContract(s,[decl('b','right','baseline'),decl('b','right','baseline')])).toThrow('declaration_binding');
});
test("source packet applies the same semantic contract to body, boxes, repeated occurrences and math choices",()=>{
 const hash='a'.repeat(64),e={id:'E',latex:String.raw`\lim_{u\to b^+}u^2`,limitApproaches:[decl('b','right','baseline')]};
 const q:any={schema:'problem-edit.source-question.v1',questionId:'Q46',printedLabel:'46',section:'multiple-choice',source:{sha256:hash,physicalPage:1,logicalOrder:1,cropPath:'crop.png',cropSha256:hash,xyxy:[0,0,1,1]},score:null,paragraphs:['Given {{E}} and {{E}}'],math:[e],statementBox:{title:null,labelStyle:'literal',items:[{label:'A',body:'{{E}}'}]},choices:[{number:1,kind:'math',latex:e.latex,limitApproaches:e.limitApproaches},{number:2,kind:'math',latex:'u^2'}],figureId:null,unresolved:[],contentOrder:[{kind:'paragraph',index:0},{kind:'statement-box'},{kind:'choices'}]};
 const p=planSourceQuestion(q,hash);const body=p.blocks[0];if(body.kind!=='paragraph')throw Error('fixture');
 expect(body.atoms.filter(x=>x.kind==='equation').map(x=>x.converterLatex)).toEqual([String.raw`\lim_{u\to b+}u^2`,String.raw`\lim_{u\to b+}u^2`]);
 delete q.choices[0].limitApproaches;expect(()=>planSourceQuestion(q,hash)).toThrow('one_sided_source_annotation_required');
});
