import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const updatePreferenceSettingsSchema = z.strictObject({
  enabled: z.boolean(),
});
export type UpdatePreferenceSettingsInput = z.output<
  typeof updatePreferenceSettingsSchema
>;
export type PreferenceSettingsResponse = {
  enabled: boolean;
  updatedAt: string;
};

export class UpdatePreferenceSettingsDto {
  @ApiProperty()
  public enabled!: boolean;
}

export class PreferenceSettingsDto {
  @ApiProperty()
  public enabled!: boolean;

  @ApiProperty()
  public updatedAt!: string;
}
