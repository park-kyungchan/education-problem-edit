import { readFileSync } from 'node:fs';
import {
  ADAPTER_VERSION, EVALUATOR_SHA256, digestText,
  adaptFrozenEvaluation, qualify, accountRequests, checkNextRequest,
  type OwnerEvaluationContext, type OwnerOccurrenceDeclarations,
  type ActualRequestReceipt, type PresentationRepair, type PlannedRequest,
  type ClaimEvidence,
} from './qualification.ts';

export const OFFLINE_SCHEMA = 'jev.offline-owner-validation.v1';
export const GUARD_SOURCE_SHA256 = '4aa073996e46852669cd82b6f1c14934f85d562cfbc0c84d7616ce8a8a235ce0';
export const MAX_OFFLINE_INPUT_BYTES = 262144;
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): v is ObjectValue => v !== null && typeof v === 'object' && !Array.isArray(v);
function exact(v: unknown, required: string[], optional: string[] = []): asserts v is ObjectValue {
  if (!object(v) || required.some(k => !Object.hasOwn(v, k)) || Object.keys(v).some(k => !required.includes(k) && !optional.includes(k))) throw Error('OFFLINE_ENVELOPE_SHAPE');
}
const boundaries = {
  allLiveGates: 'HOLD', fourHoldLifted: 0, ownerContextAuthenticated: false,
  financialPermission: false, sourceAcceptance: null, acceptanceDecision: null,
  nativeUsd: null, wholeSessionSavingsEstablished: false,
} as const;

/** Offline diagnostics only. Supplied owner JSON is not authenticated authority. */
export function validateOffline(input: unknown) {
  try {
    exact(input, ['schema', 'mode', 'guardSourceSha256', 'adapterVersion', 'evaluatorSha256'],
      ['evaluation', 'context', 'evidence', 'review', 'requests', 'declarations', 'presentationRepairs', 'nextRequest']);
    if (input.schema !== OFFLINE_SCHEMA || !['stage', 'cumulative', 'accounting', 'nextRequest'].includes(input.mode as string)) throw Error('OFFLINE_SCHEMA_OR_MODE');
    if (input.guardSourceSha256 !== GUARD_SOURCE_SHA256 || input.adapterVersion !== ADAPTER_VERSION || input.evaluatorSha256 !== EVALUATOR_SHA256 ||
        digestText(readFileSync(new URL('./qualification.ts', import.meta.url), 'utf8')) !== GUARD_SOURCE_SHA256) throw Error('OFFLINE_SOURCE_BINDING');
    const provenance = { schema: OFFLINE_SCHEMA, guardSourceSha256: GUARD_SOURCE_SHA256, adapterVersion: ADAPTER_VERSION, evaluatorSha256: EVALUATOR_SHA256, ...boundaries };
    let qualification: ReturnType<typeof qualify> | null = null;
    let accounting: ReturnType<typeof accountRequests> | null = null;
    let prospective: ReturnType<typeof checkNextRequest> | null = null;
    if (input.mode === 'stage' || input.mode === 'cumulative') {
      if (!object(input.context) || !Object.hasOwn(input, 'evaluation')) throw Error('OFFLINE_EVALUATION_REQUIRED');
      if (input.context.version !== ADAPTER_VERSION || input.context.evaluatorSha256 !== EVALUATOR_SHA256) throw Error('OFFLINE_CONTEXT_BINDING');
      if (input.mode === 'stage' ? input.context.claimScope !== 'stageDiagnostic' : input.context.claimScope !== 'observedCumulative') throw Error('OFFLINE_CLAIM_SCOPE');
      const adapted = adaptFrozenEvaluation(input.evaluation, input.context as unknown as OwnerEvaluationContext);
      if (input.mode === 'stage') qualification = qualify(adapted);
      else {
        exact(input.evidence, ['receipt']);
        exact(input.review, ['evaluation', 'context']);
        if (!object(input.review.context) || input.review.context.version !== ADAPTER_VERSION || input.review.context.evaluatorSha256 !== EVALUATOR_SHA256) throw Error('OFFLINE_REVIEW_CONTEXT_BINDING');
        // Rebuild the private adapter brand in-process; never trust serialized adapted data.
        const review = adaptFrozenEvaluation(input.review.evaluation, input.review.context as unknown as OwnerEvaluationContext);
        qualification = qualify(adapted, {
          receipt: input.evidence.receipt as ClaimEvidence['receipt'], review,
          requests: input.requests as ActualRequestReceipt[],
          declarations: input.declarations as OwnerOccurrenceDeclarations,
          presentationRepairs: (input.presentationRepairs ?? []) as PresentationRepair[],
        });
      }
    }
    if (input.mode !== 'stage') {
      if (!Array.isArray(input.requests) || !object(input.declarations) || (input.presentationRepairs !== undefined && !Array.isArray(input.presentationRepairs))) throw Error('OFFLINE_HISTORY_REQUIRED');
      const history = input.requests as ActualRequestReceipt[];
      const declarations = input.declarations as unknown as OwnerOccurrenceDeclarations;
      const repairs = (input.presentationRepairs ?? []) as PresentationRepair[];
      accounting = accountRequests(history, declarations, repairs);
      if (input.mode === 'nextRequest' && !object(input.nextRequest)) throw Error('OFFLINE_NEXT_REQUEST_REQUIRED');
      if (Object.hasOwn(input, 'nextRequest')) {
        if (!object(input.nextRequest)) throw Error('OFFLINE_NEXT_REQUEST_REQUIRED');
        prospective = checkNextRequest(history, input.nextRequest as unknown as PlannedRequest, declarations, repairs);
      }
    } else if (['requests', 'declarations', 'presentationRepairs', 'nextRequest', 'evidence', 'review'].some(k => Object.hasOwn(input, k))) throw Error('OFFLINE_STAGE_FIELDS');
    return { ...provenance, disposition: 'checked' as const, qualification, accounting, prospective };
  } catch (error) {
    return { schema: OFFLINE_SCHEMA, disposition: 'held' as const, reasons: [error instanceof Error ? error.message : 'OFFLINE_INVALID_INPUT'], ...boundaries };
  }
}

export async function readOfflineInput(stdin?: string): Promise<unknown> {
  let raw = stdin;
  if (raw === undefined) {
    const reader = Bun.stdin.stream().getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const parts: string[] = [];
    let length = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > MAX_OFFLINE_INPUT_BYTES) { await reader.cancel(); throw Error('OFFLINE_STDIN_BOUND'); }
        parts.push(decoder.decode(part.value, { stream: true }));
      }
      parts.push(decoder.decode());
    } finally { reader.releaseLock(); }
    raw = parts.join('');
  }
  if (Buffer.byteLength(raw) > MAX_OFFLINE_INPUT_BYTES) throw Error('OFFLINE_STDIN_BOUND');
  return JSON.parse(raw);
}
