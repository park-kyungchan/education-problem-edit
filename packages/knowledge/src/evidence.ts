import type { RetrievalCandidate } from './contracts';
import { sha256 } from './lib';

/** Validate exact pinned occurrences before semantic selection, without a provider call. */
export function validateOccurrence(candidate:RetrievalCandidate,bytes:Uint8Array):void{
  if(candidate.kind!=='source-occurrence')throw new Error('Metadata descriptions are not source occurrences');
  if(sha256(bytes)!==candidate.sourceSha256)throw new Error(`Source hash mismatch: ${candidate.id}`);
  const {first,last}=candidate.selector,lines=new TextDecoder().decode(bytes).split(/\r?\n/);
  if(!Number.isInteger(first)||!Number.isInteger(last)||first<1||last<first||last>lines.length)throw new Error('Invalid line selector');
  if(lines.slice(first-1,last).join('\n')!==candidate.exactText)throw new Error(`Occurrence text mismatch: ${candidate.id}`);
}

export function evidenceCoverage(requiredFacetIds:string[],candidates:RetrievalCandidate[]){
  const exact=new Set(candidates.filter(c=>c.kind==='source-occurrence').flatMap(c=>c.facetIds));
  const missingFacetIds=[...new Set(requiredFacetIds)].filter(id=>!exact.has(id));
  return {state:missingFacetIds.length?'coverage-gap':'candidate-coverage-only',missingFacetIds,
    limitation:'Coverage labels are producer assertions; occurrence validation and actual claim support remain separate checks.'};
}
