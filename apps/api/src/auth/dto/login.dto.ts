import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const loginSchema = z.strictObject({
  email: z.email({ pattern: z.regexes.html5Email }).max(255),
  password: z.string().min(8).max(128),
  captchaChallengeId: z.string().min(1).max(64),
  captchaAnswer: z.string().min(1).max(5),
});

export type LoginInput = z.infer<typeof loginSchema>;

export class LoginDto {
  @ApiProperty({
    description: '登录邮箱',
    example: 'user@example.com',
    format: 'email',
    maxLength: 255,
  })
  public email!: string;

  @ApiProperty({
    description: '登录密码',
    example: 'ChangeMe123!',
    format: 'password',
    minLength: 8,
    maxLength: 128,
  })
  public password!: string;

  @ApiProperty({
    description: '图片验证码挑战 ID',
    minLength: 1,
    maxLength: 64,
  })
  public captchaChallengeId!: string;

  @ApiProperty({
    description: '图片验证码答案',
    minLength: 1,
    maxLength: 5,
  })
  public captchaAnswer!: string;
}
