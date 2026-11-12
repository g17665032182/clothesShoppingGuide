import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { LockMode, type EntityManager } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import type { EntityRepository } from '@mikro-orm/postgresql';
import { ChatConversationAccess } from '../../chat-records/conversation-access/index.js';
import {
  PRODUCT_CATALOG_PURCHASE_PORT,
  type ProductCatalogPurchasePort,
  PRODUCT_CATALOG_ORDER_PORT,
  type ProductCatalogOrderPort,
} from '../../product-catalog/index.js';
import { OrdersService } from '../../orders/index.js';
import { ChatPurchaseDraft } from '../entity/chat-purchase-draft.entity.js';
import type {
  PatchPurchaseInput,
  StartPurchaseInput,
} from '../dto/chat-purchase.schema.js';
import type { PurchaseDraftResponse } from '../dto/chat-purchase-response.js';
import {
  PurchaseProjectionService,
  type PurchaseSku,
} from './purchase-projection.service.js';

export type PurchaseRunState = {
  fingerprint: string;
  active: boolean;
  context: string;
  reference: {
    draftId: string;
    version: number;
    orderId: string | null;
  } | null;
};

export type PurchaseDynamicFormState = {
  draft: PurchaseDraftResponse;
  skus: PurchaseSku[];
};

@Injectable()
export class PurchaseDraftService {
  public constructor(
    @InjectRepository(ChatPurchaseDraft)
    private readonly drafts: EntityRepository<ChatPurchaseDraft>,
    private readonly access: ChatConversationAccess,
    @Inject(PRODUCT_CATALOG_PURCHASE_PORT)
    private readonly catalog: ProductCatalogPurchasePort,
    @Inject(PRODUCT_CATALOG_ORDER_PORT)
    private readonly stock: ProductCatalogOrderPort,
    private readonly projection: PurchaseProjectionService,
    private readonly orders: OrdersService,
  ) {}

  public manager(): EntityManager {
    return this.drafts.getEntityManager().fork();
  }

  public async now(transaction: EntityManager): Promise<Date> {
    const [row] = await transaction
      .getConnection()
      .execute<Array<{ now: Date }>>(
        'select clock_timestamp() as now',
        [],
        'all',
        transaction.getTransactionContext(),
      );
    if (!row) throw new Error('数据库时间不可用');
    return new Date(row.now);
  }

  public async latest(
    transaction: EntityManager,
    userId: string,
    conversationId: string,
  ) {
    const active = await transaction.findOne(
      ChatPurchaseDraft,
      { userId, conversationId, status: { $in: ['collecting', 'ready'] } },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    return (
      active ??
      transaction.findOne(
        ChatPurchaseDraft,
        { userId, conversationId },
        {
          orderBy: { createdAt: 'DESC', id: 'DESC' },
          lockMode: LockMode.PESSIMISTIC_WRITE,
        },
      )
    );
  }

  public async lock(
    transaction: EntityManager,
    userId: string,
    conversationId: string,
    draftId: string,
  ) {
    await this.access.lockOwnedInTransaction(
      transaction,
      userId,
      conversationId,
    );
    const draft = await transaction.findOne(
      ChatPurchaseDraft,
      { id: draftId, userId, conversationId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (!draft) throw new NotFoundException('购买草稿不存在');
    return draft;
  }

  public async refresh(
    transaction: EntityManager,
    draft: ChatPurchaseDraft,
    userChanged = false,
  ) {
    if (!['collecting', 'ready'].includes(draft.status)) return null;
    const product = await this.catalog.getPurchaseSpecifications(
      transaction,
      draft.productExternalId,
    );
    let options: PurchaseSku[] | null = product?.skus ?? null;
    if (options && draft.skuId) {
      const selected = options.find((sku) => sku.skuId === draft.skuId);
      if (selected) {
        const [snapshot] = await this.stock.lockSkus(transaction, [
          selected.skuId,
        ]);
        // 锁等待期间商品可能已变价或下架，不能继续展示等待前的确认快照。
        options =
          (
            await this.catalog.getPurchaseSpecifications(
              transaction,
              draft.productExternalId,
            )
          )?.skus ?? null;
        const current = options?.find((sku) => sku.skuId === draft.skuId);
        const reserved = await this.stock.getReservedQuantities(transaction, [
          selected.skuId,
        ]);
        if (current)
          current.canFulfillQuantity = Boolean(
            snapshot &&
            snapshot.isSkuActive &&
            snapshot.isProductActive &&
            snapshot.stock - (reserved.get(selected.skuId) ?? 0) >=
              draft.quantity,
          );
      }
    }
    this.projection.refresh(
      draft,
      options,
      await this.now(transaction),
      userChanged,
    );
    await transaction.flush();
    return options;
  }

  public async read(userId: string, conversationId: string) {
    const draft = await this.manager().transactional(async (transaction) => {
      await this.access.lockOwnedInTransaction(
        transaction,
        userId,
        conversationId,
      );
      const current = await this.latest(transaction, userId, conversationId);
      if (current) await this.refresh(transaction, current);
      return current ? this.projection.project(current) : null;
    });
    return {
      draft,
      order: draft?.orderId
        ? await this.orders.getForUser(userId, draft.orderId)
        : null,
    };
  }

  /** 为动态表单提供当前草稿及真实 SKU 选项，绝不返回实体或精确库存。 */
  public async dynamicFormState(
    userId: string,
    conversationId: string,
  ): Promise<PurchaseDynamicFormState> {
    return this.manager().transactional(async (transaction) => {
      await this.access.lockOwnedInTransaction(
        transaction,
        userId,
        conversationId,
      );
      const draft = await this.latest(transaction, userId, conversationId);
      if (
        !draft ||
        !['collecting', 'ready'].includes(draft.status) ||
        draft.expiresAt <= (await this.now(transaction))
      ) {
        throw new NotFoundException('当前没有可编辑的购买草稿');
      }
      const product = await this.catalog.getPurchaseSpecifications(
        transaction,
        draft.productExternalId,
      );
      if (!product) throw new NotFoundException('商品信息暂不可用');
      await this.refresh(transaction, draft);
      return {
        draft: this.projection.project(draft),
        skus: product.skus,
      };
    });
  }

  public async start(
    userId: string,
    conversationId: string,
    input: StartPurchaseInput,
  ) {
    const draft = await this.manager().transactional(async (transaction) => {
      await this.access.lockOwnedInTransaction(
        transaction,
        userId,
        conversationId,
      );
      const existing = await this.latest(transaction, userId, conversationId);
      if (existing) await this.refresh(transaction, existing);
      const active =
        existing && ['collecting', 'ready'].includes(existing.status)
          ? existing
          : null;
      if (active) {
        if (active.version !== input.expectedVersion)
          throw new ConflictException('购买草稿版本已变化，请重新读取');
        if (active.productExternalId === input.productExternalId)
          return this.projection.project(active);
      } else if (input.expectedVersion !== null) {
        throw new ConflictException('当前没有进行中草稿，请重新读取');
      }
      const product = await this.catalog.getPurchaseSpecifications(
        transaction,
        input.productExternalId,
      );
      if (!product || !product.skus.some((sku) => sku.inStock))
        throw new NotFoundException('商品不存在或不可购买');
      if (active) {
        active.status = 'cancelled';
        active.confirmation = null;
        active.version += 1;
        await transaction.flush();
      }
      const now = await this.now(transaction);
      const created = Object.assign(new ChatPurchaseDraft(), {
        userId,
        conversationId,
        productExternalId: input.productExternalId,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 86_400_000),
      });
      const saleable = product.skus.filter((sku) => sku.inStock);
      if (saleable.length === 1) created.skuId = saleable[0]!.skuId;
      this.projection.refresh(created, product.skus, now, true);
      transaction.persist(created);
      await transaction.flush();
      return this.projection.project(created);
    });
    return { draft, order: null };
  }

  public async patch(
    userId: string,
    conversationId: string,
    draftId: string,
    input: PatchPurchaseInput,
  ) {
    const outcome = await this.manager().transactional(async (transaction) => {
      const draft = await this.lock(
        transaction,
        userId,
        conversationId,
        draftId,
      );
      if (
        !['collecting', 'ready'].includes(draft.status) ||
        draft.version !== input.expectedVersion
      )
        throw new ConflictException('购买草稿版本或状态已变化');
      if ((await this.now(transaction)) >= draft.expiresAt) {
        this.projection.refresh(draft, null, await this.now(transaction));
        await transaction.flush();
        return null;
      }
      if (input.skuId) {
        const product = await this.catalog.getPurchaseSpecifications(
          transaction,
          draft.productExternalId,
        );
        if (!product?.skus.some((sku) => sku.skuId === input.skuId))
          throw new ConflictException('请选择当前商品的真实规格');
      }
      let changed = false;
      const assign = <K extends keyof ChatPurchaseDraft>(
        key: K,
        value: ChatPurchaseDraft[K] | undefined,
      ) => {
        if (value !== undefined && draft[key] !== value) {
          draft[key] = value;
          changed = true;
        }
      };
      assign('skuId', input.skuId);
      assign('quantity', input.quantity);
      assign('recipientName', input.recipient?.name);
      assign('recipientPhone', input.recipient?.phone);
      assign('recipientAddress', input.recipient?.address);
      if (changed) {
        const now = await this.now(transaction);
        draft.updatedAt = now;
        draft.expiresAt = new Date(now.getTime() + 86_400_000);
        draft.version += 1;
      }
      await this.refresh(transaction, draft, changed);
      return this.projection.project(draft);
    });
    if (!outcome) throw new ConflictException('购买草稿已过期');
    return outcome;
  }

  public async discard(
    userId: string,
    conversationId: string,
    draftId: string,
    expectedVersion: number,
  ) {
    const outcome = await this.manager().transactional(async (transaction) => {
      const draft = await this.lock(
        transaction,
        userId,
        conversationId,
        draftId,
      );
      if (
        draft.version !== expectedVersion ||
        !['collecting', 'ready'].includes(draft.status)
      )
        throw new ConflictException('购买草稿版本或状态已变化');
      const now = await this.now(transaction);
      if (now >= draft.expiresAt) {
        this.projection.refresh(draft, null, now);
        await transaction.flush();
        return null;
      }
      draft.status = 'cancelled';
      draft.version += 1;
      draft.confirmation = null;
      await transaction.flush();
      return this.projection.project(draft);
    });
    // 到期状态先提交，再返回冲突；事务内抛错会回滚本次失效处理。
    if (!outcome) throw new ConflictException('购买草稿已过期');
    return outcome;
  }

  public async runStateInTransaction(
    transaction: EntityManager,
    userId: string,
    conversationId: string,
  ): Promise<PurchaseRunState> {
    const draft = await this.latest(transaction, userId, conversationId);
    if (!draft)
      return { fingerprint: '', active: false, context: '', reference: null };
    const active =
      ['collecting', 'ready'].includes(draft.status) &&
      draft.expiresAt > (await this.now(transaction));
    const reference = {
      draftId: draft.id,
      version: draft.version,
      orderId: draft.orderId,
    };
    const product = active
      ? await this.catalog.getPurchaseSpecifications(
          transaction,
          draft.productExternalId,
        )
      : null;
    return {
      fingerprint: `${draft.id}:${draft.version}`,
      active,
      reference,
      context: active
        ? JSON.stringify({
            draftId: draft.id,
            version: draft.version,
            status: draft.status,
            productExternalId: draft.productExternalId,
            skuId: draft.skuId,
            quantity: draft.quantity,
            filled: {
              name: Boolean(draft.recipientName),
              phone: Boolean(draft.recipientPhone),
              address: Boolean(draft.recipientAddress),
            },
            issues: draft.issues,
            skus: product?.skus,
          })
        : '',
    };
  }

  public async runState(userId: string, conversationId: string) {
    return this.manager().transactional(async (transaction) => {
      await this.access.lockOwnedInTransaction(
        transaction,
        userId,
        conversationId,
      );
      return this.runStateInTransaction(transaction, userId, conversationId);
    });
  }

  public async referenceInTransaction(
    transaction: EntityManager,
    userId: string,
    conversationId: string,
    draftId: string,
  ) {
    const draft = await transaction.findOne(ChatPurchaseDraft, {
      id: draftId,
      userId,
      conversationId,
    });
    if (!draft) throw new NotFoundException('购买草稿不存在');
    return {
      draftId: draft.id,
      version: draft.version,
      orderId: draft.orderId,
    };
  }
}
