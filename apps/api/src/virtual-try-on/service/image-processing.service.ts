import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp, { type Metadata } from 'sharp';

import type { TryOnImageMimeType } from '../port/try-on-image-provider.port.js';

const MIME_BY_FORMAT: Record<string, TryOnImageMimeType> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export type ProcessedTryOnImage = {
  body: Buffer;
  mimeType: TryOnImageMimeType;
  byteSize: number;
  width: number;
  height: number;
};

@Injectable()
export class TryOnImageProcessingService {
  public constructor(private readonly config: ConfigService) {}

  public async normalize(input: Buffer): Promise<ProcessedTryOnImage> {
    const maxBytes = this.readPositiveInteger(
      'TRY_ON_MAX_FILE_BYTES',
      10 * 1024 * 1024,
    );
    const maxEdge = this.readPositiveInteger('TRY_ON_MAX_EDGE', 4096);
    if (input.byteLength === 0 || input.byteLength > maxBytes)
      throw new BadRequestException('图片文件大小不符合要求');

    let metadata: Metadata;
    try {
      metadata = await sharp(input, { failOn: 'error' }).metadata();
    } catch {
      throw new BadRequestException('图片无法解析');
    }
    const format = metadata.format
      ? MIME_BY_FORMAT[metadata.format]
      : undefined;
    if (!format) throw new BadRequestException('仅支持 JPEG、PNG 或 WebP 图片');
    if ((metadata.pages ?? 1) > 1) throw new BadRequestException('不支持动图');
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width < 1 ||
      metadata.height < 1 ||
      metadata.width > maxEdge ||
      metadata.height > maxEdge
    )
      throw new BadRequestException('图片尺寸超过限制');

    try {
      const normalized = await sharp(input, { failOn: 'error' })
        .rotate()
        .webp({ quality: 90 })
        .toBuffer();
      const outputMetadata = await sharp(normalized).metadata();
      if (
        !outputMetadata.width ||
        !outputMetadata.height ||
        normalized.byteLength > maxBytes
      )
        throw new Error('normalized image exceeds limit');
      return {
        body: normalized,
        mimeType: 'image/webp',
        byteSize: normalized.byteLength,
        width: outputMetadata.width,
        height: outputMetadata.height,
      };
    } catch {
      throw new BadRequestException('图片处理失败');
    }
  }

  private readPositiveInteger(name: string, fallback: number): number {
    const value = Number(this.config.get<string | number>(name) ?? fallback);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }
}
