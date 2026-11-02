import { randomUUID } from 'node:crypto';

import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'user_memory_document_task_results' })
@Unique({
  name: 'user_memory_document_task_results_task_operation_unique',
  properties: ['taskId', 'operationKey'],
})
export class UserMemoryDocumentTaskResult {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'task_id' })
  public taskId!: string;

  @Property({ type: 'string', fieldName: 'operation_key', length: 180 })
  public operationKey!: string;

  @Property({
    type: 'timestamptz',
    fieldName: 'applied_at',
    onCreate: () => new Date(),
  })
  public appliedAt: Date = new Date();
}
