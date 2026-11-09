import { BadRequestException, Injectable } from '@nestjs/common';
import sharp from 'sharp';

export const PRODUCT_TRY_ON_MAX_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 4096;

@Injectable()
export class ProductTryOnImageProcessingService {
  public async normalize(input: Buffer | undefined): Promise<Buffer> {
    if (!input?.byteLength || input.byteLength > PRODUCT_TRY_ON_MAX_BYTES)
      throw new BadRequestException('图片文件大小不符合要求（最大 10 MiB）');
    try {
      const options = {
        failOn: 'error' as const,
        limitInputPixels: MAX_EDGE ** 2,
      };
      const metadata = await sharp(input, options).metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? ''))
        throw new BadRequestException('仅支持 JPEG、PNG 或 WebP 图片');
      if ((metadata.pages ?? 1) > 1)
        throw new BadRequestException('不支持动图');
      if (
        !metadata.width ||
        !metadata.height ||
        metadata.width > MAX_EDGE ||
        metadata.height > MAX_EDGE
      )
        throw new BadRequestException('图片最长边不能超过 4096 像素');
      // 按真实内容解码；自动旋转且不保留 EXIF，文件名与客户端 MIME 不作为依据。
      const body = await sharp(input, options)
        .rotate()
        .webp({ quality: 90 })
        .toBuffer();
      if (body.byteLength > PRODUCT_TRY_ON_MAX_BYTES)
        throw new BadRequestException('处理后的图片超过大小限制');
      return body;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('图片无法解析或尺寸超过限制');
    }
  }
}
