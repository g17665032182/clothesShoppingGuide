import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

const reasonCodes = [
  'style',
  'color',
  'price',
  'occasion',
  'fit',
  'too_exaggerated',
  'too_plain',
] as const;

export const recommendationFeedbackSchema = z
  .strictObject({
    recommendationId: z.uuid(),
    conversationId: z.uuid(),
    assistantMessageId: z.uuid(),
    targetType: z.enum(['recommendation', 'outfit', 'slot', 'item']),
    targetRef: z.string().trim().min(1).max(160),
    feedbackType: z.enum(['positive', 'negative', 'dismissed']),
    reasonCode: z.enum(reasonCodes).optional(),
    note: z
      .string()
      .trim()
      .max(240)
      .refine(
        (value) =>
          !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value),
        {
          message: '反馈不能包含控制字符',
        },
      )
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.feedbackType === 'positive' && value.reasonCode) {
      ctx.addIssue({
        code: 'custom',
        path: ['reasonCode'],
        message: '合适反馈不能填写不满意原因',
      });
    }
    if (value.feedbackType !== 'negative' && value.note) {
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message: '只有不合适反馈可以填写补充说明',
      });
    }
    if (value.feedbackType === 'negative' && !value.reasonCode && !value.note) {
      ctx.addIssue({
        code: 'custom',
        path: ['reasonCode'],
        message: '不合适反馈至少需要选择原因或填写说明',
      });
    }
  });

export type RecommendationFeedbackInput = z.output<
  typeof recommendationFeedbackSchema
>;

export type RecommendationFeedbackResponse =
  | { accepted: true; feedbackId: string }
  | { accepted: false; reason: 'learning_disabled' };

export class RecommendationFeedbackDto implements RecommendationFeedbackInput {
  @ApiProperty({ format: 'uuid' })
  public recommendationId!: string;

  @ApiProperty({ format: 'uuid' })
  public conversationId!: string;

  @ApiProperty({ format: 'uuid' })
  public assistantMessageId!: string;

  @ApiProperty({ enum: ['recommendation', 'outfit', 'slot', 'item'] })
  public targetType!: RecommendationFeedbackInput['targetType'];

  @ApiProperty({ maxLength: 160 })
  public targetRef!: string;

  @ApiProperty({ enum: ['positive', 'negative', 'dismissed'] })
  public feedbackType!: RecommendationFeedbackInput['feedbackType'];

  @ApiPropertyOptional({ enum: reasonCodes })
  public reasonCode?: RecommendationFeedbackInput['reasonCode'];

  @ApiPropertyOptional({ maxLength: 240 })
  public note?: string;
}

export class RecommendationFeedbackResponseDto {
  @ApiProperty({ type: Boolean })
  public accepted!: boolean;

  @ApiPropertyOptional({ format: 'uuid' })
  public feedbackId?: string;

  @ApiPropertyOptional({ enum: ['learning_disabled'] })
  public reason?: 'learning_disabled';
}
