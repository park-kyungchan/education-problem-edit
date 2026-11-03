/** Source-only interchange. No prior problem text, values, geometry, answers or output. */
export type Run={kind:'text';text:string}|{kind:'math';latex:string;eqScript?:string}|{kind:'blank';id:string;label?:string};
export type BBox=[number,number,number,number];
export interface Region{id:string;page:number;imagePath:string;imageSha256:string;bboxPixels:BBox;role:'problem'|'figure'|'proof'|'frame'|'header';}
export interface Block{id:string;kind:'paragraph'|'choices'|'frame'|'proof'|'figure';runs?:Run[];choices?:{label:string;runs:Run[]}[];figureId?:string;regionId?:string;rows?:Run[][];notes?:string;}
export interface Figure{id:string;problemId:string;regionId:string;description:string;labels:{label:string;role:'printed'|'handwritten'|'uncertain';position?:string}[];sourceUncertainties:string[];geometry?:unknown;}
export interface Problem{id:string;kind:'multiple-choice'|'constructed-response';number:number;page:number;regionId:string;blocks:Block[];figures:Figure[];sourceUncertainties:string[];}
export interface SourceIR{schema:'jungdong.fresh-source-ir.v1';sourceSha256:string;createdAt:string;examHeader?:Block[];problems:Problem[];sourceOnly:true;priorTranscriptionOrOutputRead:false;nativeSessionId:string;inputAccessManifest:string[];}
