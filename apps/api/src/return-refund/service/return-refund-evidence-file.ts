import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import sharp from 'sharp';

export const MAX_RETURN_REFUND_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_RETURN_REFUND_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_RETURN_REFUND_EVIDENCE_PER_APPLICATION = 5;

export type ReturnRefundEvidenceFileType = {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4';
  extension: 'jpg' | 'png' | 'webp' | 'mp4';
  maxBytes: number;
};

const imageTypes = {
  jpeg: {
    mediaType: 'image/jpeg',
    extension: 'jpg',
    maxBytes: MAX_RETURN_REFUND_IMAGE_BYTES,
  },
  png: {
    mediaType: 'image/png',
    extension: 'png',
    maxBytes: MAX_RETURN_REFUND_IMAGE_BYTES,
  },
  webp: {
    mediaType: 'image/webp',
    extension: 'webp',
    maxBytes: MAX_RETURN_REFUND_IMAGE_BYTES,
  },
} as const satisfies Record<string, ReturnRefundEvidenceFileType>;

export const RETURN_REFUND_MEDIA_TYPE_EXTENSIONS: Record<
  ReturnRefundEvidenceFileType['mediaType'],
  ReturnRefundEvidenceFileType['extension']
> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
};

export async function inspectReturnRefundEvidence(
  body: Buffer,
  declaredMimeType?: string,
): Promise<ReturnRefundEvidenceFileType> {
  if (!Buffer.isBuffer(body) || body.byteLength === 0)
    throw new BadRequestException('凭证文件不能为空');

  const imageType = await inspectImage(body);
  const fileType = imageType ?? inspectMp4(body);
  if (!fileType) throw new BadRequestException('凭证格式不支持');
  if (body.byteLength > fileType.maxBytes)
    throw new PayloadTooLargeException('凭证文件超过大小限制');
  if (
    declaredMimeType &&
    declaredMimeType !== 'application/octet-stream' &&
    declaredMimeType !== fileType.mediaType
  )
    throw new BadRequestException('凭证文件类型与实际内容不匹配');
  return fileType;
}

async function inspectImage(
  body: Buffer,
): Promise<ReturnRefundEvidenceFileType | null> {
  if (
    !body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) &&
    !body
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    !(
      body.toString('ascii', 0, 4) === 'RIFF' &&
      body.toString('ascii', 8, 12) === 'WEBP'
    )
  )
    return null;

  if (body.byteLength > MAX_RETURN_REFUND_IMAGE_BYTES)
    throw new PayloadTooLargeException('图片凭证不能超过 10 MiB');
  try {
    const image = sharp(body, {
      failOn: 'error',
      limitInputPixels: 40_000_000,
    });
    const metadata = await image.metadata();
    const format =
      metadata.format === 'jpeg' ||
      metadata.format === 'png' ||
      metadata.format === 'webp'
        ? metadata.format
        : undefined;
    const type = format ? imageTypes[format] : undefined;
    if (!type) throw new Error('unsupported image format');
    if ((metadata.pages ?? 1) > 1 || !metadata.width || !metadata.height)
      throw new Error('invalid image dimensions');
    await sharp(body, {
      failOn: 'error',
      limitInputPixels: 40_000_000,
    }).stats();
    return type;
  } catch {
    throw new BadRequestException('图片无法解码或格式不支持');
  }
}

function inspectMp4(body: Buffer): ReturnRefundEvidenceFileType | null {
  if (body.byteLength < 16 || body.toString('ascii', 4, 8) !== 'ftyp')
    return null;
  const boxSize = body.readUInt32BE(0);
  if (boxSize < 16 || boxSize > body.byteLength)
    throw new BadRequestException('MP4 凭证结构无效');
  const majorBrand = body.toString('ascii', 8, 12);
  if (!/^[\x20-\x7e]{4}$/u.test(majorBrand))
    throw new BadRequestException('MP4 凭证结构无效');
  if (body.byteLength > MAX_RETURN_REFUND_VIDEO_BYTES)
    throw new PayloadTooLargeException('视频凭证不能超过 50 MiB');
  return {
    mediaType: 'video/mp4',
    extension: 'mp4',
    maxBytes: MAX_RETURN_REFUND_VIDEO_BYTES,
  };
}
