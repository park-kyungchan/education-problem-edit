import {isDeepStrictEqual} from 'node:util';
import {requireValue} from './admission.ts';
const obj=(v:unknown):v is Record<string,any>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const json=(v:any,d=0):boolean=>d<=32&&(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)||Array.isArray(v)&&v.every(x=>json(x,d+1))||obj(v)&&Object.values(v).every(x=>json(x,d+1)));
/** Exact finite JSON Schema subset; unknown constraints reject recursively before IO. */
export function compileOutputSchema(schema:unknown):(value:unknown)=>void {
  const patterns=new Map<any,RegExp>();
  function check(s:any,depth=0):void {
    requireValue(obj(s)&&depth<=16,'UNSUPPORTED_OUTPUT_SCHEMA');
    const common=['type','title','description','$schema','enum','const','anyOf'];
    const types:Record<string,string[]>={object:['properties','required','additionalProperties'],array:['items','minItems','maxItems','uniqueItems'],string:['minLength','maxLength','pattern'],number:['minimum','maximum'],integer:['minimum','maximum'],boolean:[],null:[]};
    requireValue((s.type===undefined&&Array.isArray(s.anyOf)||Object.hasOwn(types,s.type))&&Object.keys(s).every(k=>[...common,...(types[s.type]??[])].includes(k)),'UNSUPPORTED_SCHEMA_KEYWORD');
    for(const k of ['title','description','$schema'])if(s[k]!==undefined)requireValue(typeof s[k]==='string','INVALID_SCHEMA_METADATA');
    if(Object.hasOwn(s,'const'))requireValue(json(s.const),'INVALID_SCHEMA_CONST');
    if(s.enum!==undefined)requireValue(Array.isArray(s.enum)&&s.enum.length>0&&s.enum.length<=256&&s.enum.every((v:any)=>json(v))&&s.enum.every((v:any,i:number)=>!s.enum.slice(0,i).some((x:any)=>equal(x,v))),'INVALID_SCHEMA_ENUM');
    if(s.anyOf!==undefined){requireValue(Array.isArray(s.anyOf)&&s.anyOf.length>0&&s.anyOf.length<=64,'INVALID_SCHEMA_ANYOF');for(const branch of s.anyOf)check(branch,depth+1)}
    for(const k of ['minItems','maxItems','minLength','maxLength'])if(s[k]!==undefined)requireValue(Number.isSafeInteger(s[k])&&s[k]>=0,'INVALID_SCHEMA_BOUND');
    for(const k of ['minimum','maximum'])if(s[k]!==undefined)requireValue(typeof s[k]==='number'&&Number.isFinite(s[k]),'INVALID_SCHEMA_BOUND');
    for(const [lo,hi]of [['minItems','maxItems'],['minLength','maxLength'],['minimum','maximum']])if(s[lo]!==undefined&&s[hi]!==undefined)requireValue(s[lo]<=s[hi],'INVALID_SCHEMA_BOUND');
    if(s.pattern!==undefined){requireValue(typeof s.pattern==='string'&&s.pattern.length<=4096,'INVALID_SCHEMA_PATTERN');try{patterns.set(s,new RegExp(s.pattern,'u'))}catch{throw Error('INVALID_SCHEMA_PATTERN')}}
    if(s.uniqueItems!==undefined)requireValue(typeof s.uniqueItems==='boolean','INVALID_SCHEMA_UNIQUEITEMS');
    if(s.type==='object'){
      requireValue((s.properties===undefined||obj(s.properties))&&(s.additionalProperties===false||obj(s.additionalProperties))&&Object.keys(s.properties??{}).length<=64,'EXPLICIT_OBJECT_SCHEMA_REQUIRED');
      requireValue(s.required===undefined||(Array.isArray(s.required)&&new Set(s.required).size===s.required.length&&s.required.every((x:any)=>typeof x==='string'&&Object.hasOwn(s.properties??{},x))),'INVALID_SCHEMA_REQUIRED');
      Object.values(s.properties??{}).forEach(x=>check(x,depth+1));if(obj(s.additionalProperties))check(s.additionalProperties,depth+1);
    }
    if(s.type==='array')check(s.items,depth+1);
  }
  check(schema);
  function validate(v:any,s:any):void {
    if(Object.hasOwn(s,'const'))requireValue(equal(v,s.const),'OUTPUT_SCHEMA_CONST');
    if(s.enum)requireValue(s.enum.some((x:any)=>equal(x,v)),'OUTPUT_SCHEMA_ENUM');
    if(s.anyOf)requireValue(s.anyOf.some((b:any)=>{try{validate(v,b);return true}catch{return false}}),'OUTPUT_SCHEMA_ANYOF');
    const t=s.type;if(t===undefined)return;
    requireValue(t==='object'?obj(v):t==='array'?Array.isArray(v):t==='null'?v===null:t==='integer'?Number.isSafeInteger(v):t==='number'?typeof v==='number'&&Number.isFinite(v):typeof v===t,'OUTPUT_SCHEMA_TYPE');
    if(t==='object'){requireValue(Object.keys(v).every(k=>Object.hasOwn(s.properties??{},k)||obj(s.additionalProperties))&&(s.required??[]).every((k:string)=>Object.hasOwn(v,k)),'OUTPUT_SCHEMA_PROPERTIES');for(const [k,x]of Object.entries(v))validate(x,Object.hasOwn(s.properties??{},k)?s.properties[k]:s.additionalProperties)}
    if(t==='array'){requireValue(v.length>=(s.minItems??0)&&v.length<=(s.maxItems??Number.MAX_SAFE_INTEGER),'OUTPUT_SCHEMA_ARRAY_BOUND');if(s.uniqueItems)requireValue(v.every((x:any,i:number)=>!v.slice(0,i).some((y:any)=>equal(x,y))),'OUTPUT_SCHEMA_UNIQUEITEMS');v.forEach((x:any)=>validate(x,s.items))}
    if(t==='string'){requireValue([...v].length>=(s.minLength??0)&&[...v].length<=(s.maxLength??Number.MAX_SAFE_INTEGER),'OUTPUT_SCHEMA_STRING_BOUND');if(s.pattern!==undefined)requireValue(patterns.get(s)!.test(v),'OUTPUT_SCHEMA_PATTERN')}
    if(t==='number'||t==='integer')requireValue(v>=(s.minimum??-Infinity)&&v<=(s.maximum??Infinity),'OUTPUT_SCHEMA_NUMBER_BOUND');
  }
  function equal(a:any,b:any):boolean {if(typeof a==='number'&&typeof b==='number')return a===b;if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((x,i)=>equal(x,b[i]));if(obj(a)&&obj(b))return Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));return a===b}
  return value=>{requireValue(json(value),'OUTPUT_NOT_JSON');validate(value,schema)};
}
