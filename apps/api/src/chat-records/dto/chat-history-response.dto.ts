import { ApiProperty, getSchemaPath } from '@nestjs/swagger';

import type { ChatCard, JsonValue } from '../display/chat-display.types.js';

export class ChatToolActivityResponseDto {
  @ApiProperty({ enum: ['tool'] })
  public type!: 'tool';

  @ApiProperty({ description: '本轮稳定的工具调用标识' })
  public id!: string;

  @ApiProperty({ description: '经公开投影后的安全工具名称' })
  public toolName!: string;

  @ApiProperty({ enum: ['running', 'success', 'error', 'interrupted'] })
  public status!: 'running' | 'success' | 'error' | 'interrupted';

  @ApiProperty({
    nullable: true,
    oneOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'array', items: {} },
      { type: 'object', additionalProperties: true },
    ],
    description: '显式允许公开的 JSON 输入；当前工具均为 null',
  })
  public input!: JsonValue;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '允许公开的结果；当前工具均为 null',
  })
  public output!: string | null;
}

export class ChatReasoningActivityResponseDto {
  @ApiProperty({ enum: ['reasoning'] })
  public type!: 'reasoning';

  @ApiProperty({ description: '本轮稳定的公开摘要标识' })
  public id!: string;

  @ApiProperty({ description: '供应商明确支持的公开摘要' })
  public summary!: string;
}

export class ChatSourceResponseDto {
  @ApiProperty({ description: '本轮稳定的来源标识' })
  public id!: string;

  @ApiProperty()
  public title!: string;

  @ApiProperty({ format: 'uri', description: '已校验的外部 HTTP/HTTPS URL' })
  public url!: string;
}

export class ChatContextResponseDto {
  @ApiProperty({ minimum: 1, description: '当前轮次固定的模型窗口' })
  public contextWindowTokens!: number;

  @ApiProperty({ type: Number, minimum: 0, nullable: true })
  public inputTokens!: number | null;

  @ApiProperty({ type: Number, minimum: 0, nullable: true })
  public outputTokens!: number | null;

  @ApiProperty({
    type: Number,
    minimum: 0,
    nullable: true,
    description: '输入和输出均已知时的安全整数之和，否则为 null',
  })
  public usedTokens!: number | null;
}

export class ChatMessageResponseDto {
  @ApiProperty({ format: 'uuid' })
  public id!: string;

  @ApiProperty({ format: 'uuid' })
  public conversationId!: string;

  @ApiProperty({ enum: ['user', 'assistant'] })
  public role!: 'user' | 'assistant';

  @ApiProperty()
  public content!: string;

  @ApiProperty({ type: String, nullable: true })
  public model!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  public inputTokens!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  public outputTokens!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  public totalTokens!: number | null;

  @ApiProperty({ type: String, format: 'date-time' })
  public createdAt!: string;

  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(ChatToolActivityResponseDto) },
        { $ref: getSchemaPath(ChatReasoningActivityResponseDto) },
      ],
      discriminator: {
        propertyName: 'type',
        mapping: {
          tool: getSchemaPath(ChatToolActivityResponseDto),
          reasoning: getSchemaPath(ChatReasoningActivityResponseDto),
        },
      },
    },
    description: '安全展示活动；用户消息和旧记录为 []',
  })
  public activities!: Array<
    ChatToolActivityResponseDto | ChatReasoningActivityResponseDto
  >;

  @ApiProperty({
    type: [ChatSourceResponseDto],
    description: '来源快照，默认为 []',
  })
  public sources!: ChatSourceResponseDto[];

  @ApiProperty({
    type: 'array',
    description:
      '由服务端白名单投影并绑定到本条 assistant 消息的商品或只读订单卡片',
    items: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'name', 'data'],
          properties: {
            type: { type: 'string', enum: ['card'] },
            name: { type: 'string', enum: ['product'] },
            data: {
              type: 'object',
              additionalProperties: false,
              required: ['items'],
              properties: {
                items: {
                  type: 'array',
                  maxItems: 5,
                  items: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'name', 'data'],
          properties: {
            type: { type: 'string', enum: ['card'] },
            name: { type: 'string', enum: ['order'] },
            data: {
              type: 'object',
              additionalProperties: false,
              required: ['items'],
              properties: {
                items: {
                  type: 'array',
                  maxItems: 5,
                  items: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
      ],
    },
  })
  public cards!: ChatCard[];

  @ApiProperty({
    type: () => ChatContextResponseDto,
    nullable: true,
    description: '保存时的最终模型用量；用户消息和旧记录为 null',
  })
  public context!: ChatContextResponseDto | null;
}

export class ChatMessagePageResponseDto {
  @ApiProperty({ type: [ChatMessageResponseDto] })
  public items!: ChatMessageResponseDto[];

  @ApiProperty()
  public total!: number;

  @ApiProperty()
  public page!: number;

  @ApiProperty()
  public pageSize!: number;

  @ApiProperty()
  public totalPages!: number;
}

export class ChatConversationDetailResponseDto {
  @ApiProperty({ format: 'uuid' })
  public id!: string;

  @ApiProperty({ format: 'uuid' })
  public userId!: string;

  @ApiProperty()
  public title!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  public createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  public updatedAt!: string;

  @ApiProperty({ type: () => ChatMessagePageResponseDto })
  public messages!: ChatMessagePageResponseDto;
}
