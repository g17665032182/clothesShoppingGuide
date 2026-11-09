import { randomUUID } from 'node:crypto';
import {
  Entity,
  Enum,
  Index,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

export enum TryOnTaskStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  DELETED = 'deleted',
}

@Entity({ tableName: 'try_on_tasks' })
@Index({
  name: 'try_on_tasks_user_created_index',
  properties: ['userId', 'createdAt'],
})
@Index({
  name: 'try_on_tasks_claim_index',
  properties: ['status', 'availableAt', 'createdAt'],
})
export class TryOnTask {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'user_id' })
  public userId!: string;

  @Enum({ items: () => TryOnTaskStatus })
  public status: TryOnTaskStatus = TryOnTaskStatus.QUEUED;

  @Property({ type: 'string', fieldName: 'product_external_id', length: 160 })
  public productExternalId!: string;

  @Property({ type: 'string', fieldName: 'product_name', length: 200 })
  public productName!: string;

  @Property({ type: 'string', fieldName: 'product_category', length: 32 })
  public productCategory!: string;

  @Property({ type: 'string', length: 32 })
  public color!: string;

  @Property({ type: 'text', fieldName: 'garment_image_url', nullable: true })
  public garmentImageUrl: string | null = null;

  @Property({ type: 'uuid', fieldName: 'source_photo_id', nullable: true })
  public sourcePhotoId: string | null = null;

  @Property({ type: 'string', fieldName: 'consent_version', length: 80 })
  public consentVersion!: string;

  @Property({ type: 'timestamptz', fieldName: 'consented_at' })
  public consentedAt = new Date();

  @Property({ type: 'integer', default: 0 })
  public attempts = 0;

  @Property({ type: 'timestamptz', fieldName: 'available_at' })
  public availableAt = new Date();

  @Property({ type: 'timestamptz', fieldName: 'locked_at', nullable: true })
  public lockedAt: Date | null = null;

  @Property({
    type: 'string',
    fieldName: 'failure_code',
    length: 80,
    nullable: true,
  })
  public failureCode: string | null = null;

  @Property({
    type: 'string',
    fieldName: 'provider_model',
    length: 120,
    nullable: true,
  })
  public providerModel: string | null = null;

  @Property({
    type: 'string',
    fieldName: 'provider_request_id',
    length: 200,
    nullable: true,
  })
  public providerRequestId: string | null = null;

  @Property({
    type: 'timestamptz',
    fieldName: 'notification_read_at',
    nullable: true,
  })
  public notificationReadAt: Date | null = null;

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

  @Property({
    type: 'timestamptz',
    fieldName: 'completed_at',
    nullable: true,
  })
  public completedAt: Date | null = null;

  @Property({ type: 'timestamptz', fieldName: 'deleted_at', nullable: true })
  public deletedAt: Date | null = null;
}
