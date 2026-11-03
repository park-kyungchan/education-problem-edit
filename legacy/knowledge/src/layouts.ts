import type { LayoutProfile, LayoutSelection, NativeDocumentFormat } from './contracts';

const sharedContent = ['semantic question content and order', 'native equation scripts, environment-bound metrics and baseline',
  'corrected figure payloads and bindings', 'whole-question borderless native ownership', 'nested example/proof/blank structures'] as const;
export const layoutProfiles: LayoutProfile[] = [
  { id: 'exam-two-column', title: 'Original two-column exam sheet', columns: 2, formatIndependent: true, sharedContent,
    composition: ['Reuse the original column-major exam page template and first-page heading.',
      'Keep question-local content independent of page slots; derive slot sizes and overflow from the current exam.'],
    evidence: [{sourceId:'S-imagepatch-receipt'}, {sourceId:'S-pageF'}, {sourceId:'S-hwp-inputs'}],
    observedInstance: {exam:'daechi-20261022', pages:6, questionsPerPage:4, questions:24,
      artifactPath:'/WINDOWS_USER/Downloads/대치중_2026_2학년_2학기_중간고사_개선_v3.hwpx',
      artifactSha256:'4dae49b2b37078d257e86e09802a3f2c6fefd05383ac84248eecca691b74ccfe',nativeFormat:'hwpx',instanceOnly:true,
      templateParameters:{readingOrder:'column-major; Daechi instance slots only'}},
    limitation:'Four questions per page and six pages describe this instance. Layout choice does not select the output format or impose those counts on future exams.'},
  { id:'reference-single-column',title:'Reference-HWP single-column flow',columns:1,formatIndependent:true,sharedContent,
    composition:['Use the observed reference paper, margins and paragraph rhythm after checking the current reference.',
      'Move whole-question containers out of obsolete page envelopes; retain native content and nested ownership.',
      'Use content-aware flow and explicit whole-question overflow review rather than copying old page heights.'],
    evidence:[{sourceId:'S-hwp-handoff'},{sourceId:'S-hwp-verification'},{sourceId:'S-hwp-procedure'}],
    observedInstance:{exam:'daechi-20261022',pages:12,questionsPerPage:2,questions:24,
      artifactPath:'/WINDOWS_USER/Downloads/Daechi-HWP-layout-20261022/2026 2학기 중간 2학년 대치.hwp',
      artifactSha256:'c01811e777271e23125e1bf79bd6559988a761aa384ee240c65c7391a9048d1a',nativeFormat:'hwp',instanceOnly:true,
      templateParameters:{paperWidthHwp:59528,paperHeightHwp:84186,leftHwp:8504,rightHwp:8504,topHwp:5668,bottomHwp:4252,
        headerHwp:4252,footerHwp:4252,gutterHwp:0,questionWidthHwp:30000,lineSpacingPercent:160,interQuestionBlankParagraphs:3}},
    limitation:'This adapts an incomplete, differently ordered reference while retaining all 24 v3 questions. Twelve pages, two questions/page and exact dimensions are instance observations, not universal constraints.'},
];

export function validateLayoutProfiles(profiles:LayoutProfile[],sourceIds:string[]):void{
  const ids=new Set<string>();
  for(const p of profiles){
    if(ids.has(p.id))throw new Error(`Duplicate layout ${p.id}`);ids.add(p.id);
    if(!p.formatIndependent||!p.observedInstance.instanceOnly)throw new Error('Layout must remain format-independent with instance-scoped counts');
    if(!/^[a-f0-9]{64}$/.test(p.observedInstance.artifactSha256))throw new Error(`Invalid layout artifact hash ${p.id}`);
    for(const e of p.evidence)if(!sourceIds.includes(e.sourceId))throw new Error(`Unknown layout source ${e.sourceId}`);
  }
  if(!ids.has('exam-two-column')||!ids.has('reference-single-column'))throw new Error('Both authorized layouts must be preserved');
}

export function resolveLayout(profiles:LayoutProfile[],options:{requested?:string;existing?:string;format?:string}):LayoutSelection{
  if(options.format&&!['hwp','hwpx'].includes(options.format))throw new Error('format must be hwp or hwpx');
  const find=(id:string)=>{const p=profiles.find(p=>p.id===id);if(!p)throw new Error(`Unknown layout profile ${id}`);return p;};
  // Validate supplied existing identity even when an explicit change supersedes it.
  if(options.existing)find(options.existing);
  const id=options.requested??options.existing;
  if(!id)return {state:'selection-required',choices:profiles.map(({id,title,columns})=>({id,title,columns})),
    format:(options.format as NativeDocumentFormat)??null,next:'Offer both profiles and obtain the user choice before composing a new document. File format alone never selects a layout.'};
  return {state:'selected',profile:find(id),reason:options.requested?'explicit-choice':'preserve-existing-profile',
    format:(options.format as NativeDocumentFormat)??null,instanceCountsAreConstraints:false};
}
