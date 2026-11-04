import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'user_preference_settings' })
export class UserPreferenceSetting {
  @PrimaryKey({ type: 'uuid', fieldName: 'user_id' })
  public userId!: string;

  @Property({ type: 'boolean', default: true })
  public enabled = true;

  @Property({
    type: 'timestamptz',
    fieldName: 'created_at',
    onCreate: () => new Date(),
  })
  public createdAt: Date = new Date();

  @Property({
    type: 'timestamptz',
    fieldName: 'updated_at',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  public updatedAt: Date = new Date();
}
