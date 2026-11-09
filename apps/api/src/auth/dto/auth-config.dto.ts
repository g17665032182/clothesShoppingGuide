import { ApiProperty } from '@nestjs/swagger';

export class AuthConfigDto {
  @ApiProperty({
    description: '当前环境是否要求登录图片验证码',
    example: true,
  })
  public captchaEnabled!: boolean;
}
