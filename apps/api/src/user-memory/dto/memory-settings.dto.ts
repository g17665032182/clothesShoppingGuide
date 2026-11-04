import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const updateMemorySettingsSchema = z.strictObject({
  enabled: z.boolean(),
});

export type UpdateMemorySettingsInput = z.infer<
  typeof updateMemorySettingsSchema
>;

export type MemorySettingsResponse = {
  enabled: boolean;
  updatedAt: string;
};

export class UpdateMemorySettingsDto implements UpdateMemorySettingsInput {
  @ApiProperty({ type: Boolean })
  public enabled!: boolean;
}

export class MemorySettingsDto implements MemorySettingsResponse {
  @ApiProperty({ type: Boolean })
  public enabled!: boolean;

  @ApiProperty({ type: String })
  public updatedAt!: string;
}
