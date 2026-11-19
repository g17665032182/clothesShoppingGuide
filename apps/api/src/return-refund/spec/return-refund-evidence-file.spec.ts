import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';

import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

import {
  inspectReturnRefundEvidence,
  MAX_RETURN_REFUND_IMAGE_BYTES,
  MAX_RETURN_REFUND_VIDEO_BYTES,
} from '../service/return-refund-evidence-file.js';

function mp4Header(): Buffer {
  const body = Buffer.alloc(24);
  body.writeUInt32BE(body.byteLength, 0);
  body.write('ftyp', 4, 'ascii');
  body.write('isom', 8, 'ascii');
  body.writeUInt32BE(0, 12);
  body.write('isom', 16, 'ascii');
  body.write('mp42', 20, 'ascii');
  return body;
}

test('图片须实际可解码并按内容映射 JPEG/PNG/WebP', async () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    const body = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 12, g: 34, b: 56 },
      },
    })
      [format]()
      .toBuffer();
    const type = await inspectReturnRefundEvidence(body);
    assert.equal(
      type.mediaType,
      `image/${format === 'jpeg' ? 'jpeg' : format}`,
    );
  }
});

test('拒绝声明类型与实际内容不一致及仅伪造图片签名的内容', async () => {
  const body = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 12, g: 34, b: 56 },
    },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    inspectReturnRefundEvidence(body, 'image/jpeg'),
    (error: unknown) =>
      error instanceof BadRequestException && error.getStatus() === 400,
  );
  await assert.rejects(
    inspectReturnRefundEvidence(
      Buffer.from([0xff, 0xd8, 0xff, 0x00]),
      'image/jpeg',
    ),
    (error: unknown) =>
      error instanceof BadRequestException && error.getStatus() === 400,
  );
});

test('校验 MP4 ftyp 签名并拒绝其他容器', async () => {
  const type = await inspectReturnRefundEvidence(mp4Header(), 'video/mp4');
  assert.equal(type.mediaType, 'video/mp4');
  await assert.rejects(
    inspectReturnRefundEvidence(Buffer.from('not a video'), 'video/mp4'),
    (error: unknown) =>
      error instanceof BadRequestException && error.getStatus() === 400,
  );
});

test('图片和视频分别应用 10 MiB 与 50 MiB 限额', async () => {
  const tooLargeImage = Buffer.alloc(MAX_RETURN_REFUND_IMAGE_BYTES + 1);
  tooLargeImage.set([0xff, 0xd8, 0xff]);
  await assert.rejects(
    inspectReturnRefundEvidence(tooLargeImage, 'image/jpeg'),
    (error: unknown) =>
      error instanceof PayloadTooLargeException && error.getStatus() === 413,
  );

  const tooLargeVideo = Buffer.alloc(MAX_RETURN_REFUND_VIDEO_BYTES + 1);
  tooLargeVideo.writeUInt32BE(16, 0);
  tooLargeVideo.write('ftyp', 4, 'ascii');
  tooLargeVideo.write('isom', 8, 'ascii');
  await assert.rejects(
    inspectReturnRefundEvidence(tooLargeVideo, 'video/mp4'),
    (error: unknown) =>
      error instanceof PayloadTooLargeException && error.getStatus() === 413,
  );
});
