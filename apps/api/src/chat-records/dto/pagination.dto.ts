import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class PaginationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public page = 1;

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
