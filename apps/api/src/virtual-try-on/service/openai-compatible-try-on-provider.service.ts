import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  TryOnProviderError,
  type TryOnImageMimeType,
  type TryOnImageProvider,
} from '../port/try-on-image-provider.port.js';

const DEFAULT_TIMEOUT_MS = 150_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_RESPONSE_BYTES = Math.ceil((MAX_OUTPUT_BYTES * 4) / 3) + 1024 * 1024;

type ProviderImageData = {
  b64_json?: unknown;
  url?: unknown;
};

type ProviderResponse = {
  data?: unknown;
  id?: unknown;
};

@Injectable()
export class OpenaiCompatibleTryOnProviderService implements TryOnImageProvider {
  public constructor(private readonly config: ConfigService) {}

  public async generate(input: {
    person: Buffer;
    garment: Buffer;
    model: string;
    prompt: string;
    signal: AbortSignal;
  }): Promise<{
    image: Buffer;
    mimeType: TryOnImageMimeType;
    providerRequestId: string | null;
  }> {
    const baseUrl = this.requiredConfig('TRY_ON_BASE_URL').replace(/\/+$/, '');
    const apiKey = this.requiredConfig('TRY_ON_API_KEY');
    const model = input.model.trim() || this.requiredConfig('TRY_ON_MODEL');
    const timeoutMs = this.readPositiveInteger(
      'TRY_ON_TIMEOUT_MS',
      DEFAULT_TIMEOUT_MS,
    );

    const form = new FormData();
    form.append('model', model);
    form.append('prompt', input.prompt);
    form.append('size', 'auto');
    form.append('n', '1');
    form.append(
      'image[]',
      new Blob([Uint8Array.from(input.person)], { type: 'image/webp' }),
      'person.webp',
    );
    form.append(
      'image[]',
      new Blob([Uint8Array.from(input.garment)], { type: 'image/webp' }),
      'garment.webp',
    );

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        redirect: 'error',
        signal: this.withTimeout(input.signal, timeoutMs),
      });
    } catch (error) {
      if (this.isAbort(error, input.signal)) {
        throw new TryOnProviderError('PROVIDER_TIMEOUT');
      }
      throw new TryOnProviderError('TRANSIENT_PROVIDER_ERROR');
    }

    const requestId = this.readRequestId(response.headers);
    if (!response.ok) {
      // 不向上层传递供应商原文，避免把策略、密钥或内部信息泄露给客户端。
      if (
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500
      )
        throw new TryOnProviderError('TRANSIENT_PROVIDER_ERROR');
      throw new TryOnProviderError('PROVIDER_REJECTED');
    }

    let payload: ProviderResponse;
    try {
      const responseBytes = await this.readBoundedResponse(response);
      payload = JSON.parse(responseBytes.toString('utf8')) as ProviderResponse;
    } catch (error) {
      if (error instanceof TryOnProviderError) throw error;
      throw new TryOnProviderError('INVALID_PROVIDER_OUTPUT');
    }

    const imageData = this.firstImageData(payload.data);
    if (!imageData || typeof imageData.b64_json !== 'string') {
      throw new TryOnProviderError('INVALID_PROVIDER_OUTPUT');
    }
    const image = this.decodeBase64(imageData.b64_json);
    if (image.byteLength === 0 || image.byteLength > MAX_OUTPUT_BYTES) {
      throw new TryOnProviderError('INVALID_PROVIDER_OUTPUT');
    }
    const mimeType = await this.detectMimeType(image);
    if (!mimeType) throw new TryOnProviderError('INVALID_PROVIDER_OUTPUT');

    return {
      image,
      mimeType,
      providerRequestId:
        typeof payload.id === 'string' ? payload.id.slice(0, 200) : requestId,
    };
  }

  private firstImageData(value: unknown): ProviderImageData | null {
    if (!Array.isArray(value) || value.length === 0) return null;
    const image = value[0];
    if (!image || typeof image !== 'object') return null;
    return image as ProviderImageData;
  }

  private decodeBase64(value: string): Buffer {
    const normalized = value.replace(/\s+/g, '');
    if (
      normalized.length === 0 ||
      normalized.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
    ) {
      throw new TryOnProviderError('INVALID_PROVIDER_OUTPUT');
    }
    const image = Buffer.from(normalized, 'base64');
    if (
      image.toString('base64').replace(/=+$/, '') !==
      normalized.replace(/=+$/, '')
    ) {
      throw new TryOnProviderError('INVALID_PROVIDER_OUTPUT');
    }
    return image;
  }

  private async detectMimeType(
    buffer: Buffer,
  ): Promise<TryOnImageMimeType | null> {
    // 只通过文件签名确认类型，不信任供应商声明的 MIME。
    const header = buffer.subarray(0, 12);
    if (
      header.length >= 8 &&
      header[0] === 0x89 &&
      header[1] === 0x50 &&
      header[2] === 0x4e &&
      header[3] === 0x47
    )
      return 'image/png';
    if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8)
      return 'image/jpeg';
    if (
      header.length >= 12 &&
      header.toString('ascii', 0, 4) === 'RIFF' &&
      header.toString('ascii', 8, 12) === 'WEBP'
    )
      return 'image/webp';
    return null;
  }

  private async readBoundedResponse(response: Response): Promise<Buffer> {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES)
      throw new TryOnProviderError('INVALID_PROVIDER_OUTPUT');
    if (!response.body) throw new TryOnProviderError('INVALID_PROVIDER_OUTPUT');

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new TryOnProviderError('INVALID_PROVIDER_OUTPUT');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, byteLength);
  }

  private requiredConfig(name: string): string {
    const value = this.config.get<string>(name)?.trim();
    if (!value) throw new TryOnProviderError('TRANSIENT_PROVIDER_ERROR');
    return value;
  }

  private readPositiveInteger(name: string, fallback: number): number {
    const raw = this.config.get<string | number>(name);
    const value = Number(raw ?? fallback);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }

  private withTimeout(signal: AbortSignal, timeoutMs: number): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs);
    return AbortSignal.any([signal, timeout]);
  }

  private isAbort(error: unknown, signal: AbortSignal): boolean {
    return (
      signal.aborted ||
      (error instanceof DOMException && error.name === 'TimeoutError')
    );
  }

  private readRequestId(headers: Headers): string | null {
    const value = headers.get('x-request-id') ?? headers.get('request-id');
    return value?.trim().slice(0, 200) || null;
  }
}
