import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type RecommendationProfileTag = {
  label: string;
  confidence: number;
  evidenceCount: number;
};

export type RecommendationProfileResponse = {
  preferredStyles: RecommendationProfileTag[];
  avoidedStyles: RecommendationProfileTag[];
  preferredOccasions: RecommendationProfileTag[];
  priceSensitivity: string | null;
  silhouetteSignals: RecommendationProfileTag[];
  evidenceCount: number;
  version: number;
  generation: number;
  updatedAt: string | null;
  learningEnabled: boolean;
};

export class RecommendationProfileTagDto implements RecommendationProfileTag {
  @ApiProperty()
  public label!: string;

  @ApiProperty()
  public confidence!: number;

  @ApiProperty()
  public evidenceCount!: number;
}

export class RecommendationProfileResponseDto implements RecommendationProfileResponse {
  @ApiProperty({ type: [RecommendationProfileTagDto] })
  public preferredStyles!: RecommendationProfileTag[];

  @ApiProperty({ type: [RecommendationProfileTagDto] })
  public avoidedStyles!: RecommendationProfileTag[];

  @ApiProperty({ type: [RecommendationProfileTagDto] })
  public preferredOccasions!: RecommendationProfileTag[];

  @ApiPropertyOptional({ nullable: true })
  public priceSensitivity!: string | null;

  @ApiProperty({ type: [RecommendationProfileTagDto] })
  public silhouetteSignals!: RecommendationProfileTag[];

  @ApiProperty()
  public evidenceCount!: number;

  @ApiProperty()
  public version!: number;

  @ApiProperty()
  public generation!: number;

  @ApiPropertyOptional({ nullable: true })
  public updatedAt!: string | null;

  @ApiProperty()
  public learningEnabled!: boolean;
}
