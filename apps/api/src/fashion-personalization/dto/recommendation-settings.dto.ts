import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const recommendationSettingsSchema = z.strictObject({
  enabled: z.boolean(),
});

export type RecommendationSettingsInput = z.output<
  typeof recommendationSettingsSchema
>;

export type RecommendationSettingsResponse = {
  enabled: boolean;
  updatedAt: string;
};

export class RecommendationSettingsDto implements RecommendationSettingsResponse {
  @ApiProperty({ type: Boolean })
  public enabled!: boolean;

  @ApiProperty({ type: String })
  public updatedAt!: string;
}

export class UpdateRecommendationSettingsDto implements RecommendationSettingsInput {
  @ApiProperty({ type: Boolean })
  public enabled!: boolean;
}
