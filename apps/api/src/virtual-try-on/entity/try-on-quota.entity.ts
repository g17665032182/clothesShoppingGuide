import { randomUUID } from 'node:crypto';
import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'try_on_quotas' })
@Unique({
  name: 'try_on_quotas_user_date_unique',
  properties: ['userId', 'quotaDate'],
})
export class TryOnQuota {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'user_id' })
  public userId!: string;

  @Property({ type: 'date', fieldName: 'quota_date' })
  public quotaDate!: string;

  @Property({ type: 'integer', fieldName: 'success_count', default: 0 })
  public successCount = 0;

  @Property({
    type: 'timestamptz',
    fieldName: 'created_at',
    onCreate: () => new Date(),
  })
  public createdAt = new Date();

  @Property({
    type: 'timestamptz',
    fieldName: 'updated_at',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  public updatedAt = new Date();
}
