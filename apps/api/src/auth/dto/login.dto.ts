import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: '登录邮箱',
    example: 'user@example.com',
    format: 'email',
    maxLength: 255,
  })
  @IsEmail()
  @MaxLength(255)
  public email!: string;

  @ApiProperty({
    description: '登录密码',
    example: 'ChangeMe123!',
    format: 'password',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  public password!: string;

  @ApiProperty({
    description: '图片验证码挑战 ID',
    minLength: 1,
    maxLength: 64,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  public captchaChallengeId!: string;

  @ApiProperty({
    description: '图片验证码答案',
    minLength: 1,
    maxLength: 5,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(5)
  public captchaAnswer!: string;
}
