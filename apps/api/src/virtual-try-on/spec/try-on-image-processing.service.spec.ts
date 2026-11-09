import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';

import { TryOnImageProcessingService } from '../service/image-processing.service.js';

function createService(config: Record<string, string | number> = {}) {
  return new TryOnImageProcessingService(new ConfigService(config));
}

test('图片处理校验格式和边界，旋转后移除 EXIF 元数据', async () => {
  const source = await sharp({
    create: {
      width: 12,
      height: 8,
      channels: 3,
      background: '#cc3344',
    },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const result = await createService().normalize(source);
  const metadata = await sharp(result.body).metadata();

  assert.equal(result.mimeType, 'image/webp');
  assert.equal(result.width, 8);
  assert.equal(result.height, 12);
  assert.equal(metadata.exif, undefined);
  assert.ok(metadata.pages === undefined || metadata.pages === 1);
});

test('图片处理拒绝文件大小、尺寸、不支持格式和不可解码输入', async () => {
  const tooLarge = await sharp({
    create: {
      width: 10,
      height: 10,
      channels: 3,
      background: '#ffffff',
    },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    createService({ TRY_ON_MAX_FILE_BYTES: 10 }).normalize(tooLarge),
    BadRequestException,
  );
  await assert.rejects(
    createService({ TRY_ON_MAX_EDGE: 9 }).normalize(tooLarge),
    BadRequestException,
  );
  const gif = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 3,
      background: '#ffffff',
    },
  })
    .gif()
    .toBuffer();
  await assert.rejects(createService().normalize(gif), BadRequestException);
  await assert.rejects(
    createService().normalize(Buffer.from('not an image')),
    BadRequestException,
  );
});
