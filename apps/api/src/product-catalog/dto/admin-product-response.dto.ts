import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminProductSummaryDto {
  @ApiProperty({ format: 'uuid' })
  public id!: string;

  @ApiProperty()
  public externalId!: string;

  @ApiProperty()
  public name!: string;

  @ApiPropertyOptional({ nullable: true })
  public brand!: string | null;

  @ApiProperty()
  public category!: string;

  @ApiPropertyOptional({ nullable: true })
  public productUrl!: string | null;

  @ApiProperty()
  public isActive!: boolean;

  @ApiProperty({ description: '管理员保存的商品试穿开关', default: false })
  public tryOnEnabled!: boolean;

  @ApiProperty()
  public skuCount!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  public lowestPrice!: string | null;

  @ApiProperty()
  public totalStock!: number;

  @ApiProperty()
  public totalAvailableStock!: number;

  @ApiProperty({ format: 'date-time' })
  public createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  public updatedAt!: string;
}

export class AdminProductSkuDto {
  @ApiProperty({ format: 'uuid' })
  public id!: string;

  @ApiProperty()
  public externalSkuId!: string;

  @ApiProperty()
  public color!: string;

  @ApiProperty()
  public size!: string;

  @ApiProperty({ type: String })
  public price!: string;

  @ApiProperty({ enum: ['CNY'] })
  public currency!: 'CNY';

  @ApiProperty()
  public stock!: number;

  @ApiProperty()
  public reservedStock!: number;

  @ApiProperty()
  public availableStock!: number;

  @ApiPropertyOptional({ nullable: true })
  public imageUrl!: string | null;

  @ApiProperty()
  public isActive!: boolean;
}

export class AdminProductDetailDto extends AdminProductSummaryDto {
  @ApiProperty({ description: '是否已保存商品级私有试穿图片' })
  public hasTryOnImage!: boolean;

  @ApiPropertyOptional({ nullable: true })
  public description!: string | null;

  @ApiProperty({ type: [String] })
  public styles!: string[];

  @ApiProperty({ type: [String] })
  public occasions!: string[];

  @ApiProperty({ type: [String] })
  public fits!: string[];

  @ApiProperty({ type: [AdminProductSkuDto] })
  public skus!: AdminProductSkuDto[];
}

export class AdminProductPageDto {
  @ApiProperty({ type: [AdminProductSummaryDto] })
  public items!: AdminProductSummaryDto[];

  @ApiProperty()
  public total!: number;

  @ApiProperty()
  public page!: number;

  @ApiProperty({ maximum: 100 })
  public pageSize!: number;
}
