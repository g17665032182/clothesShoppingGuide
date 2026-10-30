import { ApiProperty } from '@nestjs/swagger';

export class CaptchaResponseDto {
  @ApiProperty({ description: '验证码挑战 ID' })
  public challengeId!: string;

  @ApiProperty({
    description: '验证码图片的 SVG data URI',
    example: 'data:image/svg+xml;base64,...',
  })
  public imageData!: string;

  @ApiProperty({ description: '验证码类型', enum: ['image'] })
  public type!: 'image';
}
