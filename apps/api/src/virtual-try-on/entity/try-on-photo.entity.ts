import { randomUUID } from 'node:crypto';
import {
  Entity,
  Enum,
  Index,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

export enum TryOnPhotoKind {
  TEMPORARY = 'temporary',
  SAVED = 'saved',
}

export enum TryOnPhotoStatus {
  ACTIVE = 'active',
  DELETED = 'deleted',
}

@Entity({ tableName: 'try_on_photos' })
@Index({
  name: 'try_on_photos_user_kind_status_created_index',
  properties: ['userId', 'kind', 'status', 'createdAt'],
})
@Index({
  name: 'try_on_photos_status_expires_index',
  properties: ['status', 'expiresAt'],
})
@Unique({ name: 'try_on_photos_object_key_unique', properties: ['objectKey'] })
export class TryOnPhoto {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'user_id' })
  public userId!: string;

  @Enum({ items: () => TryOnPhotoKind })
  public kind: TryOnPhotoKind = TryOnPhotoKind.TEMPORARY;

  @Enum({ items: () => TryOnPhotoStatus })
  public status: TryOnPhotoStatus = TryOnPhotoStatus.ACTIVE;

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

  @Property({ type: 'timestamptz', fieldName: 'expires_at', nullable: true })
  public expiresAt: Date | null = null;

  @Property({ type: 'uuid', fieldName: 'task_id', nullable: true })
  public taskId: string | null = null;

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

  @Property({ type: 'timestamptz', fieldName: 'deleted_at', nullable: true })
  public deletedAt: Date | null = null;
}
