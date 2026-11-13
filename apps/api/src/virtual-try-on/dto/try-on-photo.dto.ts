import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const photoSaveSchema = z.strictObject({
  save: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((value) =>
      typeof value === 'boolean' ? value : value === 'true' || value === '1',
    )
    .default(false),
});

export class TryOnPhotoDto {
  @ApiProperty({ format: 'uuid' })
  public id!: string;
  @ApiProperty({ enum: ['temporary', 'saved'] })
  public kind!: string;
  @ApiProperty()
  public mimeType!: string;
  @ApiProperty()
  public byteSize!: number;
  @ApiProperty()
  public width!: number;
  @ApiProperty()
  public height!: number;
  @ApiProperty()
  public createdAt!: string;
}

export type TryOnAvailability =
  'disabled' | 'test_images_unconfigured' | 'test_only' | 'available';

// 聊天信息查询只暴露图片元数据，不包含图片内容或对象存储位置。
export type TryOnSavedPhotoMetadataItemDto = {
  photoId: string;
  kind: 'person';
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  createdAt: string;
  availability: 'saved';
};

export type TryOnSavedPhotoMetadataPageDto = {
  items: TryOnSavedPhotoMetadataItemDto[];
  page: number;
  pageSize: 5;
  total: number;
};

export class TryOnPhotoPageDto {
  @ApiProperty({ type: [TryOnPhotoDto] })
  public items!: TryOnPhotoDto[];

  @ApiProperty({
    enum: ['disabled', 'test_images_unconfigured', 'test_only', 'available'],
  })
  public availability!: TryOnAvailability;
}

export class TryOnTaskResultDto {
  @ApiProperty({ format: 'uuid' })
  public resultId!: string;
  @ApiProperty()
  public createdAt!: string;
  @ApiProperty()
  public width!: number;
  @ApiProperty()
  public height!: number;
  @ApiProperty()
  public downloadable!: boolean;
}

export class TryOnTaskDto {
  @ApiProperty({ format: 'uuid' })
  public id!: string;
  @ApiProperty({
    enum: ['queued', 'processing', 'succeeded', 'failed', 'deleted'],
  })
  public status!: string;
  @ApiProperty()
  public product!: Record<string, unknown>;
  @ApiProperty({ nullable: true, type: TryOnTaskResultDto })
  public result!: TryOnTaskResultDto | null;
  @ApiProperty()
  public notification!: { unread: boolean };
  @ApiProperty({ nullable: true })
  public failureCode!: string | null;
  @ApiProperty()
  public createdAt!: string;
  @ApiProperty({ nullable: true })
  public completedAt!: string | null;
}
