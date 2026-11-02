import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'user_memory_document_states' })
export class UserMemoryDocumentState {
  @PrimaryKey({ type: 'uuid', fieldName: 'user_id' })
  public userId!: string;

  @Property({ type: 'integer', default: 0 })
  public revision = 0;

  @Property({
    type: 'string',
    fieldName: 'object_key',
    length: 512,
    nullable: true,
  })
  public objectKey: string | null = null;

  @Property({ type: 'integer', fieldName: 'document_generation', default: 0 })
  public documentGeneration = 0;

  @Property({ type: 'string', fieldName: 'content_hash', length: 64 })
  public contentHash!: string;

  @Property({
    type: 'timestamptz',
    fieldName: 'updated_at',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  public updatedAt: Date = new Date();
}
