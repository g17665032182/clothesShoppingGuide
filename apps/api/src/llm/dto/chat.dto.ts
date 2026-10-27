import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  registerDecorator,
  type ValidationOptions,
  type ValidatorConstraintInterface,
  ValidatorConstraint,
  ValidateNested,
} from 'class-validator';

export const MAX_CHAT_MESSAGES = 20;
export const MAX_CHAT_MESSAGE_LENGTH = 8_000;
export const MAX_CHAT_TOTAL_LENGTH = 32_000;

@ValidatorConstraint({ name: 'chatTotalLength', async: false })
class ChatTotalLengthConstraint implements ValidatorConstraintInterface {
  public validate(value: unknown): boolean {
    if (!Array.isArray(value)) {
      return false;
    }
    const lengths = value.map((message) => {
      if (typeof message !== 'object' || message === null) {
        return null;
      }
      const content = (message as { content?: unknown }).content;
      return typeof content === 'string' ? content.length : null;
    });
    return (
      lengths.every((length): length is number => length !== null) &&
      lengths.reduce((total, length) => total + length, 0) <=
        MAX_CHAT_TOTAL_LENGTH
    );
  }

  public defaultMessage(): string {
    return `消息总长度不能超过 ${MAX_CHAT_TOTAL_LENGTH} 个字符`;
  }
}

function IsChatTotalLengthWithinLimit(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    registerDecorator({
      name: 'chatTotalLength',
      target: target.constructor,
      propertyName: propertyKey.toString(),
      validator: ChatTotalLengthConstraint,
      ...(validationOptions ? { options: validationOptions } : {}),
    });
  };
}

export enum ChatMessageRole {
  SYSTEM = 'system',
  USER = 'user',
  ASSISTANT = 'assistant',
}

export class ChatMessageDto {
  @ApiProperty({
    description: '消息角色',
    enum: ChatMessageRole,
    example: ChatMessageRole.USER,
  })
  @IsEnum(ChatMessageRole)
  public role!: ChatMessageRole;

  @ApiProperty({
    description: '消息文本',
    example: '请推荐适合春季通勤的穿搭。',
    minLength: 1,
    maxLength: MAX_CHAT_MESSAGE_LENGTH,
  })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(MAX_CHAT_MESSAGE_LENGTH)
  public content!: string;
}

export class ChatDto {
  @ApiPropertyOptional({
    description: '已有会话 ID；不传则创建新会话',
    format: 'uuid',
    example: '9c2c6f3b-4d12-4a9e-8c0a-8d6d0a8b8c1e',
  })
  @IsOptional()
  @IsUUID()
  public conversationId?: string;

  @ApiProperty({
    description: '本轮聊天消息，最多 20 条',
    type: () => [ChatMessageDto],
    minItems: 1,
    maxItems: MAX_CHAT_MESSAGES,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CHAT_MESSAGES)
  @IsChatTotalLengthWithinLimit()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  public messages!: ChatMessageDto[];
}
