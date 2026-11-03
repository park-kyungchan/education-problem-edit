import {isDeepStrictEqual} from 'node:util';
import {isAbsolute,resolve} from 'node:path';
import {requireValue} from './admission.ts';
import {FROZEN_PUBLIC} from './frozen-public.ts';
export interface PublicInventory {root:string;manifestSha256:string;entries:readonly {caseId:string;path:string;sha256:string;role:string}[]}
const hex=(s:string)=>/^[a-f0-9]{64}$/.test(s);
const privateSegments=new Set(['targets','expected','private','evaluator','evaluators','parent-transcript','candidate-r2','candidate-r3','candidate-r4']);
export function publicInventory(inv:PublicInventory=FROZEN_PUBLIC):PublicInventory {
 requireValue(isAbsolute(inv.root)&&resolve(inv.root)===inv.root&&hex(inv.manifestSha256)&&Array.isArray(inv.entries)&&inv.entries.length>0&&inv.entries.length<=2048,'PUBLIC_INVENTORY_REQUIRED');
 if(inv.manifestSha256===FROZEN_PUBLIC.manifestSha256)requireValue(isDeepStrictEqual(inv,FROZEN_PUBLIC),'FROZEN_PUBLIC_INVENTORY_MUTATION');
 const paths=new Set<string>();
 for(const e of inv.entries){requireValue(typeof e.caseId==='string'&&e.caseId.length>0&&isAbsolute(e.path)&&resolve(e.path)===e.path&&e.path.startsWith(inv.root+'/')&&hex(e.sha256)&&['request','evidence','image','schema'].includes(e.role)&&!paths.has(e.path),'PUBLIC_INVENTORY_ENTRY');paths.add(e.path);denyPrivate(e.path)}
 return inv;
}
function denyPrivate(path:string){requireValue(!path.split('/').some(s=>privateSegments.has(s.toLowerCase())),'PRIVATE_EXPOSURE')}
export function assertPublicExposure(caseId:string,entries:readonly {path:string;sha256:string;role?:string}[],inventory:PublicInventory=FROZEN_PUBLIC){
 publicInventory(inventory);const paths=new Set<string>();
 for(const e of entries){denyPrivate(e.path);requireValue(isAbsolute(e.path)&&resolve(e.path)===e.path&&!paths.has(e.path),'PUBLIC_EXPOSURE_PATH');paths.add(e.path);const p=inventory.entries.find(x=>x.path===e.path&&x.caseId===caseId);requireValue(p&&p.sha256===e.sha256&&(e.role===undefined||p.role===e.role),'PRIVATE_OR_UNDECLARED_EXPOSURE')}
}
