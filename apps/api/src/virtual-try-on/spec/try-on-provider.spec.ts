import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigService } from '@nestjs/config';

import { TryOnProviderError } from '../port/try-on-image-provider.port.js';
import { OpenaiCompatibleTryOnProviderService } from '../service/openai-compatible-try-on-provider.service.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pWQAAAAASUVORK5CYII=',
  'base64',
);
const baseConfig = {
  TRY_ON_BASE_URL: 'https://provider.example.test/v1',
  TRY_ON_API_KEY: 'development-only-test-key',
  TRY_ON_MODEL: 'test-model',
  TRY_ON_TIMEOUT_MS: 1_000,
};

function createProvider(values: Record<string, string | number> = baseConfig) {
  return new OpenaiCompatibleTryOnProviderService(new ConfigService(values));
}

const input = () => ({
  person: Buffer.from('person-webp'),
  garment: Buffer.from('garment-webp'),
  model: 'test-model',
  prompt: 'safe prompt',
  signal: new AbortController().signal,
});

test('供应商适配器以 multipart 双图请求并只解码有界 Base64 图片', async (t) => {
  let requestInit: RequestInit | undefined;
  t.mock.method(
    globalThis,
    'fetch',
    async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      assert.equal(url, 'https://provider.example.test/v1/images/edits');
      requestInit = init;
      return Response.json(
        { id: 'request-123', data: [{ b64_json: png.toString('base64') }] },
        { headers: { 'x-request-id': 'header-request' } },
      );
    },
  );

  const result = await createProvider().generate(input());
  assert.equal(requestInit?.method, 'POST');
  assert.equal(requestInit?.redirect, 'error');
  assert.equal(
    new Headers(requestInit?.headers).get('authorization'),
    'Bearer development-only-test-key',
  );
  assert.ok(requestInit?.body instanceof FormData);
  const form = requestInit.body as FormData;
  assert.equal(form.get('model'), 'test-model');
  assert.equal(form.get('size'), 'auto');
  assert.equal(form.get('n'), '1');
  const images = form.getAll('image[]');
  assert.equal(images.length, 2);
  assert.equal((images[0] as File).name, 'person.webp');
  assert.equal((images[1] as File).name, 'garment.webp');
  assert.equal(result.image.toString('base64'), png.toString('base64'));
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.providerRequestId, 'request-123');
});

test('供应商临时故障、拒绝与非法输出映射为稳定错误码', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(null, { status: 503 }),
  );
  await assert.rejects(
    createProvider().generate(input()),
    (error: unknown) =>
      error instanceof TryOnProviderError &&
      error.code === 'TRANSIENT_PROVIDER_ERROR',
  );
  t.mock.reset();

  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(null, { status: 422 }),
  );
  await assert.rejects(
    createProvider().generate(input()),
    (error: unknown) =>
      error instanceof TryOnProviderError && error.code === 'PROVIDER_REJECTED',
  );
  t.mock.reset();

  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ data: [{ b64_json: 'not-base64!' }] }),
  );
  await assert.rejects(
    createProvider().generate(input()),
    (error: unknown) =>
      error instanceof TryOnProviderError &&
      error.code === 'INVALID_PROVIDER_OUTPUT',
  );
});

test('供应商 URL 和凭据故障不会被回传为原始错误', async (t) => {
  const provider = createProvider({
    ...baseConfig,
    TRY_ON_BASE_URL: 'not a URL',
  });
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('must not call fetch');
  });
  await assert.rejects(provider.generate(input()));
});
