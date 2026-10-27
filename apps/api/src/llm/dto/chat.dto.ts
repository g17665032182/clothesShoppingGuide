import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsString,
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
  @IsEnum(ChatMessageRole)
  public role!: ChatMessageRole;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(MAX_CHAT_MESSAGE_LENGTH)
  public content!: string;
}

export class ChatDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CHAT_MESSAGES)
  @IsChatTotalLengthWithinLimit()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  public messages!: ChatMessageDto[];
}
