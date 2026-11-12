export const CHAT_TRY_ON_PORT = Symbol('CHAT_TRY_ON_PORT');

export type ChatTryOnStatus = {
  taskId: string;
  status: 'queued' | 'processing';
};

export type ChatTryOnResult = {
  taskId: string;
  product: {
    externalId: string;
    name: string;
    color: string;
  };
  result: {
    width: number;
    height: number;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  };
  image: Buffer;
};

export type ChatTryOnOutcome =
  | { status: 'succeeded'; result: ChatTryOnResult }
  | {
      status: 'failed' | 'timed_out';
      taskId?: string;
      code: string;
    };

export interface ChatTryOnPort {
  run(input: {
    userId: string;
    productExternalId: string;
    color: string;
    photoId: string;
    consentVersion: string;
    signal?: AbortSignal;
    onStatus?: (status: ChatTryOnStatus) => void;
  }): Promise<ChatTryOnOutcome>;
  canReadResult(userId: string, taskId: string): Promise<boolean>;
}
