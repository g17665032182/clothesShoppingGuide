export const TRY_ON_OBJECT_STORE = Symbol('TRY_ON_OBJECT_STORE');

export interface TryOnObjectStore {
  putPhoto(input: {
    userId: string;
    id: string;
    body: Buffer;
    mimeType: string;
  }): Promise<string>;
  putResult(input: {
    userId: string;
    id: string;
    body: Buffer;
    mimeType: string;
  }): Promise<string>;
  getObject(objectKey: string): Promise<Buffer>;
  getPrivateDownloadUrl(objectKey: string, ttlSeconds: number): Promise<string>;
  deleteObject(objectKey: string): Promise<void>;
}
