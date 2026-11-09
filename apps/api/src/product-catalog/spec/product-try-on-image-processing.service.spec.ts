import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { BadRequestException } from '@nestjs/common';

import {
  PRODUCT_TRY_ON_MAX_BYTES,
  ProductTryOnImageProcessingService,
} from '../service/product-try-on-image-processing.service.js';

test('商品图片验证真实格式并移除元数据后转 WebP', async () => {
  const service = new ProductTryOnImageProcessingService();
  const source = await sharp({
    create: { width: 40, height: 24, channels: 3, background: '#bb5533' },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Artist: 'private test value' } } })
    .toBuffer();
  const normalized = await service.normalize(source);
  const metadata = await sharp(normalized).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 40);
  assert.equal(metadata.height, 24);
  assert.equal(metadata.exif, undefined);
});

test('商品图片拒绝伪装格式、动图、过大文件和不可解码数据', async () => {
  const service = new ProductTryOnImageProcessingService();
  const gif = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#ffffff' },
  })
    .gif()
    .toBuffer();
  await assert.rejects(
    service.normalize(Buffer.from('not an image')),
    BadRequestException,
  );
  await assert.rejects(service.normalize(gif), BadRequestException);
  await assert.rejects(
    service.normalize(Buffer.alloc(PRODUCT_TRY_ON_MAX_BYTES + 1)),
    BadRequestException,
  );
});
