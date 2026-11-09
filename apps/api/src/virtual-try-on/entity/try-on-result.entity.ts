import { randomUUID } from 'node:crypto';
import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'try_on_results' })
@Unique({ name: 'try_on_results_task_unique', properties: ['taskId'] })
@Unique({ name: 'try_on_results_object_key_unique', properties: ['objectKey'] })
export class TryOnResult {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'task_id' })
  public taskId!: string;

  @Property({ type: 'uuid', fieldName: 'user_id' })
  public userId!: string;

  @Property({ type: 'string', fieldName: 'object_key', length: 512 })
  public objectKey!: string;

  @Property({ type: 'string', fieldName: 'mime_type', length: 100 })
  public mimeType!: string;

  @Property({ type: 'integer', fieldName: 'byte_size' })
  public byteSize!: number;

  @Property({ type: 'integer' })
  public width!: number;

  @Property({ type: 'integer' })
  public height!: number;

  @Property({
    type: 'timestamptz',
    fieldName: 'created_at',
    onCreate: () => new Date(),
  })
  public createdAt = new Date();

  @Property({ type: 'timestamptz', fieldName: 'deleted_at', nullable: true })
  public deletedAt: Date | null = null;
}
