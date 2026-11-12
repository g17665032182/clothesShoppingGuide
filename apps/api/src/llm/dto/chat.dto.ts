import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const MAX_CHAT_MESSAGES = 20;
export const MAX_CHAT_MESSAGE_LENGTH = 8_000;
export const MAX_CHAT_TOTAL_LENGTH = 32_000;

const boundedText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\u0000-\u001f\u007f]*$/u);

export const tryOnActionSchema = z.strictObject({
  productExternalId: boundedText(160),
  color: boundedText(32),
  photoId: z.uuid(),
  consentVersion: boundedText(80),
});

export enum ChatMessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}

const chatMessageSchema = z.strictObject({
  role: z.enum([ChatMessageRole.USER, ChatMessageRole.ASSISTANT]),
  content: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_LENGTH),
});

export const chatSchema = z.strictObject({
  conversationId: z.uuid().optional(),
  messages: z
    .array(chatMessageSchema)
    .min(1)
    .max(MAX_CHAT_MESSAGES)
    .refine(
      (messages) =>
        messages.reduce(
          (total, message) => total + message.content.length,
          0,
        ) <= MAX_CHAT_TOTAL_LENGTH,
      `消息总长度不能超过 ${MAX_CHAT_TOTAL_LENGTH} 个字符`,
    ),
  tryOnAction: tryOnActionSchema.optional(),
});

export type ChatInput = z.infer<typeof chatSchema>;
export type TryOnActionInput = z.infer<typeof tryOnActionSchema>;

export class ChatMessageDto {
  @ApiProperty({
    description: '消息角色',
    enum: ChatMessageRole,
    example: ChatMessageRole.USER,
  })
  public role!: ChatMessageRole;

  @ApiProperty({
    description: '消息文本',
    example: '请推荐适合春季通勤的穿搭。',
    minLength: 1,
    maxLength: MAX_CHAT_MESSAGE_LENGTH,
  })
  public content!: string;
}

export class ChatDto {
  @ApiPropertyOptional({
    description: '已有会话 ID；不传则创建新会话',
    format: 'uuid',
    example: '9c2c6f3b-4d12-4a9e-8c0a-8d6d0a8b8c1e',
  })
  public conversationId?: string;

  @ApiProperty({
    description: '本轮聊天消息，最多 20 条',
    type: () => [ChatMessageDto],
    minItems: 1,
    maxItems: MAX_CHAT_MESSAGES,
  })
  public messages!: ChatMessageDto[];

  @ApiPropertyOptional({
    description: '商品卡触发的试穿动作；身份从认证上下文获取',
    type: 'object',
    additionalProperties: false,
    properties: {
      productExternalId: { type: 'string', maxLength: 160 },
      color: { type: 'string', maxLength: 32 },
      photoId: { type: 'string', format: 'uuid' },
      consentVersion: { type: 'string', maxLength: 80 },
    },
  })
  public tryOnAction?: TryOnActionInput;
}
