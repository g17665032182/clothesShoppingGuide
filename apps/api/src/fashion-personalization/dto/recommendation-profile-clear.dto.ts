import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const recommendationProfileClearSchema = z.strictObject({
  confirm: z.literal(true),
});

export type RecommendationProfileClearInput = z.output<
  typeof recommendationProfileClearSchema
>;

export class RecommendationProfileClearDto implements RecommendationProfileClearInput {
  @ApiProperty({ enum: [true] })
  public confirm!: true;
}
