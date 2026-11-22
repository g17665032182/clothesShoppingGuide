import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'recommendation_profiles' })
export class RecommendationProfile {
  @PrimaryKey({ type: 'uuid', fieldName: 'user_id' })
  public userId!: string;

  @Property({ type: 'json', fieldName: 'preferred_styles' })
  public preferredStyles: Array<Record<string, unknown>> = [];

  @Property({ type: 'json', fieldName: 'avoided_styles' })
  public avoidedStyles: Array<Record<string, unknown>> = [];

  @Property({ type: 'json', fieldName: 'preferred_occasions' })
  public preferredOccasions: Array<Record<string, unknown>> = [];

  @Property({
    type: 'string',
    fieldName: 'price_sensitivity',
    length: 24,
    nullable: true,
  })
  public priceSensitivity: string | null = null;

  @Property({ type: 'json', fieldName: 'silhouette_signals' })
  public silhouetteSignals: Array<Record<string, unknown>> = [];

  @Property({ type: 'integer', fieldName: 'evidence_count', default: 0 })
  public evidenceCount = 0;

  @Property({ type: 'integer', default: 1 })
  public version = 1;

  @Property({ type: 'integer', default: 0 })
  public generation = 0;

  @Property({
    type: 'timestamptz',
    fieldName: 'updated_at',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  public updatedAt: Date = new Date();
}
