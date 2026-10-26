import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  public displayName?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  public password?: string;
}
