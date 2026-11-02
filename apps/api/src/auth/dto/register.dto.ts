import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const registerSchema = z.strictObject({
  email: z.email({ pattern: z.regexes.html5Email }).max(255),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(100),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export class RegisterDto {
  @ApiProperty({
    description: '用户邮箱',
    example: 'user@example.com',
    format: 'email',
    maxLength: 255,
  })
  public email!: string;

  @ApiProperty({
    description: '用户密码',
    example: 'ChangeMe123!',
    format: 'password',
    minLength: 8,
    maxLength: 128,
  })
  public password!: string;

  @ApiProperty({
    description: '显示名称',
    example: '春日衣橱',
    minLength: 1,
    maxLength: 100,
  })
  public displayName!: string;
}
