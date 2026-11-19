export const RETURN_REFUND_EVIDENCE_STORE = Symbol(
  'RETURN_REFUND_EVIDENCE_STORE',
);

export type ReturnRefundEvidenceExtension = 'jpg' | 'png' | 'webp' | 'mp4';

export interface ReturnRefundEvidenceStore {
  put(input: {
    userId: string;
    applicationId: string;
    evidenceId: string;
    extension: ReturnRefundEvidenceExtension;
    body: Buffer;
  }): Promise<string>;
  get(objectKey: string, maxBytes: number): Promise<Buffer>;
  delete(objectKey: string): Promise<void>;
}
