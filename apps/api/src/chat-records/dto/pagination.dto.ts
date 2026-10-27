import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class PaginationDto {
  @ApiPropertyOptional({
    description: '页码，从 1 开始',
    type: Number,
    default: 1,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public page = 1;

  @ApiPropertyOptional({
    description: '每页数量，范围 1-100',
    type: Number,
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  public pageSize = 20;

  public get normalizedPage(): number {
    return Number.isInteger(this.page) && this.page >= 1 ? this.page : 1;
  }

  public get normalizedPageSize(): number {
    return Number.isInteger(this.pageSize) && this.pageSize >= 1
      ? Math.min(this.pageSize, 100)
      : 20;
  }

  public get offset(): number {
    return (this.normalizedPage - 1) * this.normalizedPageSize;
  }
}
