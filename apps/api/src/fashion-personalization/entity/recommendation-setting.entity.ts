import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'recommendation_settings' })
export class RecommendationSetting {
  @PrimaryKey({ type: 'uuid', fieldName: 'user_id' })
  public userId!: string;

  @Property({ type: 'boolean', default: true })
  public enabled = true;

  @Property({
    type: 'timestamptz',
    fieldName: 'updated_at',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  public updatedAt: Date = new Date();
}
