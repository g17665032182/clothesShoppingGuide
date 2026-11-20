import { randomUUID } from 'node:crypto';

import {
  Entity,
  Index,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'return_refund_evidence' })
@Unique({
  name: 'return_refund_evidence_object_key_unique',
  properties: ['objectKey'],
})
@Index({
  name: 'return_refund_evidence_application_created_index',
  properties: ['applicationId', 'createdAt', 'id'],
})
export class ReturnRefundEvidence {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'application_id' })
  public applicationId!: string;

  @Property({ type: 'string', fieldName: 'object_key', length: 512 })
  public objectKey!: string;

  @Property({ type: 'string', fieldName: 'media_type', length: 32 })
  public mediaType!: string;

  @Property({ type: 'integer', fieldName: 'byte_size' })
  public byteSize!: number;

  @Property({ type: 'string', length: 64 })
  public sha256!: string;

  @Property({
    type: 'timestamptz',
    fieldName: 'deleted_at',
    nullable: true,
  })
  public deletedAt: Date | null = null;

  @Property({
    type: 'timestamptz',
    fieldName: 'created_at',
    onCreate: () => new Date(),
  })
  public createdAt = new Date();
}
