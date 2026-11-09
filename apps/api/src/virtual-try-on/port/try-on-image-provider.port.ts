export const TRY_ON_IMAGE_PROVIDER = Symbol('TRY_ON_IMAGE_PROVIDER');

export type TryOnImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export type TryOnProviderFailureCode =
  | 'TRANSIENT_PROVIDER_ERROR'
  | 'PROVIDER_REJECTED'
  | 'INVALID_PROVIDER_OUTPUT'
  | 'PROVIDER_TIMEOUT';

export class TryOnProviderError extends Error {
  public constructor(
    public readonly code: TryOnProviderFailureCode,
    message = code,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'TryOnProviderError';
  }
}

export interface TryOnImageProvider {
  generate(input: {
    person: Buffer;
    garment: Buffer;
    model: string;
    prompt: string;
    signal: AbortSignal;
  }): Promise<{
    image: Buffer;
    mimeType: TryOnImageMimeType;
    providerRequestId: string | null;
  }>;
}
