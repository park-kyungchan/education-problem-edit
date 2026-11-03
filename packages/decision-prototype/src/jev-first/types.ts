/** Pinned adopt-first API. Importing these types performs no I/O. */
export interface Question {
  type: 'choice' | 'score' | 'noul' | 'box';
  instructions?: unknown;
  criteria?: unknown;
}
export interface ImageAsset {
  type: 'image';
  format: 'png' | 'jpg' | 'jpeg';
  data_base64: string;
}
export interface JevRequest {
  state: unknown;
  questions: Record<string, Question>;
  assets?: Record<string, ImageAsset>;
  images?: boolean;
}
export interface JevContext {
  taskId: string;
  receiptRoot: string;
  keyPath?: string;
  ledgerPath?: string;
}
export interface JevResult {
  status: 'ok' | 'error' | 'ambiguous';
  answers: Record<string, unknown>;
  usage: unknown;
  model: string | null;
  reportedCostUsd: string | null;
  receiptPath: string;
  requestId: string;
  httpStatus: number | null;
}
