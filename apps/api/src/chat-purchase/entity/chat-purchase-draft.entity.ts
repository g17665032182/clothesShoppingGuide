import { randomUUID } from 'node:crypto';
import {
  Entity,
  PrimaryKey,
  Property,
  Index,
  Unique,
} from '@mikro-orm/decorators/legacy';
import type {
  PurchaseConfirmation,
  PurchaseIssue,
  PurchaseStatus,
} from '../dto/chat-purchase-response.js';

@Entity({ tableName: 'chat_purchase_drafts' })
@Index({ properties: ['conversationId', 'createdAt', 'id'] })
export class ChatPurchaseDraft {
  @PrimaryKey({ type: 'uuid' }) public id: string = randomUUID();
  @Property({ type: 'uuid', fieldName: 'user_id' }) public userId!: string;
  @Property({ type: 'uuid', fieldName: 'conversation_id' })
  public conversationId!: string;
  @Property({ type: 'string', length: 160 }) public productExternalId!: string;
  @Property({ type: 'uuid', nullable: true }) public skuId: string | null =
    null;
  @Property({ type: 'integer' }) public quantity = 1;
  @Property({ type: 'string', length: 100, nullable: true })
  public recipientName: string | null = null;
  @Property({ type: 'string', length: 21, nullable: true })
  public recipientPhone: string | null = null;
  @Property({ type: 'string', length: 500, nullable: true })
  public recipientAddress: string | null = null;
  @Property({ type: 'string', length: 20 }) public status: PurchaseStatus =
    'collecting';
  @Property({ type: 'integer' }) public version = 1;
  @Property({ type: 'json', nullable: true })
  public confirmation: PurchaseConfirmation | null = null;
  @Property({ type: 'json' }) public issues: PurchaseIssue[] = [];
  @Property({ type: 'uuid' }) @Unique() public submissionKey: string =
    randomUUID();
  @Property({ type: 'integer', nullable: true }) public submittedVersion:
    | number
    | null = null;
  @Property({ type: 'uuid', nullable: true }) @Unique() public orderId:
    | string
    | null = null;
  @Property({ type: 'timestamptz' }) public createdAt: Date = new Date();
  // 仅有效用户修改续期，不配置通用 onUpdate。
  @Property({ type: 'timestamptz' }) public updatedAt: Date = new Date();
  @Property({ type: 'timestamptz' }) public expiresAt: Date = new Date(
    Date.now() + 86_400_000,
  );
}
