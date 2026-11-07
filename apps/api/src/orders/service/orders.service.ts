import { createHash, randomBytes } from 'node:crypto';

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LockMode,
  UniqueConstraintViolationException,
  type EntityManager,
} from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import {
  PRODUCT_CATALOG_ORDER_PORT,
  type ProductCatalogOrderPort,
  type ProductCatalogOrderSku,
} from '../../product-catalog/index.js';
import {
  AdminOrderQueryDto,
  CustomerOrderQueryDto,
} from '../dto/order-query.dto.js';
import type { CreateOrderInput } from '../dto/create-order.dto.js';
import type { ShipOrderInput } from '../dto/ship-order.dto.js';
import {
  Order,
  OrderCloseReason,
  OrderStatus,
} from '../entity/order.entity.js';
import { OrderIdempotency } from '../entity/order-idempotency.entity.js';
import { OrderItem } from '../entity/order-item.entity.js';
import {
  UnavailableOrderLockSetChangedError,
  type OrderCatalogImportPort,
  type UnavailableOrderLockSet,
} from '../port/order-catalog-import.port.js';
import type {
  AdminOrderDetailResponseDto,
  AdminOrderPageResponseDto,
  AdminOrderSummaryResponseDto,
  OrderDetailResponseDto,
  OrderItemResponseDto,
  OrderPageResponseDto,
  OrderSummaryResponseDto,
} from '../dto/order-response.dto.js';

type OrderPageQuery = CustomerOrderQueryDto | AdminOrderQueryDto;
type CreateOrderResult = {
  order: OrderDetailResponseDto;
  created: boolean;
};
type LockedOrder = {
  order: Order;
  items: OrderItem[];
};
type ActionResult<T> = {
  value: T;
  expired: boolean;
};

@Injectable()
export class OrdersService implements OrderCatalogImportPort {
  public constructor(
    @InjectRepository(Order)
    private readonly orders: EntityRepository<Order>,
    @Inject(PRODUCT_CATALOG_ORDER_PORT)
    private readonly catalog: ProductCatalogOrderPort,
  ) {}

  public async createForUser(
    userId: string,
    input: CreateOrderInput,
  ): Promise<CreateOrderResult> {
    const requestHash = this.hashRequest(input);
    try {
      return await this.manager().transactional(async (em) => {
        // 按用户和幂等键串行化首次请求，避免相同请求排队后误报库存不足。
        await em
          .getConnection()
          .execute(
            'select pg_advisory_xact_lock(hashtextextended(?, 0))',
            [`order-idempotency:${userId}:${input.idempotencyKey}`],
            'run',
            em.getTransactionContext(),
          );
        const previous = await em.findOne(OrderIdempotency, {
          userId,
          idempotencyKey: input.idempotencyKey,
        });
        if (previous) {
          if (previous.requestHash !== requestHash)
            throw new ConflictException('幂等键已用于不同的下单请求');
          const order = await em.findOne(Order, { id: previous.orderId });
          if (!order) throw new ConflictException('订单幂等记录不一致');
          await this.closeIfExpired(em, order.id);
          const current = await em.findOneOrFail(Order, { id: order.id });
          return {
            order: await this.detailProjection(em, current, false),
            created: false,
          };
        }

        const skuIds = input.items
          .map((item) => item.skuId)
          .sort((left, right) => left.localeCompare(right));
        const snapshots = await this.catalog.lockSkus(em, skuIds);
        const snapshotById = new Map(
          snapshots.map((snapshot) => [snapshot.skuId, snapshot]),
        );
        const reserved = await this.catalog.getReservedQuantities(em, skuIds);
        const lines: Array<{
          snapshot: ProductCatalogOrderSku;
          quantity: number;
          unitPrice: string;
          lineAmount: string;
        }> = [];
        let totalMinor = 0n;

        for (const item of input.items) {
          const snapshot = snapshotById.get(item.skuId);
          if (
            !snapshot ||
            !snapshot.isProductActive ||
            !snapshot.isSkuActive ||
            snapshot.currency !== 'CNY'
          ) {
            throw new NotFoundException('商品规格不存在或不可下单');
          }
          const reservedQuantity = reserved.get(item.skuId) ?? 0;
          if (snapshot.stock - reservedQuantity < item.quantity)
            throw new ConflictException('商品规格库存不足');

          const unitMinor = this.toMinorUnits(snapshot.price);
          const lineMinor = unitMinor * BigInt(item.quantity);
          totalMinor += lineMinor;
          lines.push({
            snapshot,
            quantity: item.quantity,
            unitPrice: this.formatMinorUnits(unitMinor),
            lineAmount: this.formatMinorUnits(lineMinor),
          });
        }

        const now = await this.databaseNow(em);
        const order = em.create(Order, {
          orderNo: this.newOrderNumber(),
          userId,
          status: OrderStatus.PENDING_PAYMENT,
          closeReason: null,
          currency: 'CNY',
          itemsAmount: this.formatMinorUnits(totalMinor),
          shippingAmount: '0.00',
          discountAmount: '0.00',
          payableAmount: this.formatMinorUnits(totalMinor),
          paymentMode: 'simulated',
          recipientName: input.recipient.name,
          recipientPhone: input.recipient.phone,
          recipientAddress: input.recipient.address,
          expiresAt: new Date(now.getTime() + 30 * 60_000),
          createdAt: now,
          updatedAt: now,
        });
        em.persist(order);
        await em.flush();
        const orderItems = lines.map(
          ({ snapshot, quantity, unitPrice, lineAmount }) =>
            em.create(OrderItem, {
              orderId: order.id,
              skuId: snapshot.skuId,
              productExternalId: snapshot.productExternalId,
              productName: snapshot.productName,
              color: snapshot.color,
              size: snapshot.size,
              imageUrl: snapshot.imageUrl,
              unitPrice,
              quantity,
              lineAmount,
            }),
        );
        em.persist(orderItems);
        await em.flush();
        em.create(OrderIdempotency, {
          userId,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          orderId: order.id,
          createdAt: now,
        });
        await em.flush();
        return {
          order: await this.detailProjection(em, order, false),
          created: true,
        };
      });
    } catch (error) {
      if (!(error instanceof UniqueConstraintViolationException)) throw error;
      return this.readIdempotentRetry(userId, input, requestHash);
    }
  }

  public async listForUser(
    userId: string,
    query: CustomerOrderQueryDto,
  ): Promise<OrderPageResponseDto> {
    return this.list(query, { userId }, false);
  }

  public async getForUser(
    userId: string,
    orderId: string,
  ): Promise<OrderDetailResponseDto> {
    const em = this.manager();
    const order = await em.findOne(Order, { id: orderId, userId });
    if (!order) throw new NotFoundException('订单不存在');
    return this.detailProjection(em, order, false);
  }

  public async simulatePayment(
    userId: string,
    orderId: string,
  ): Promise<OrderDetailResponseDto> {
    const result = await this.manager().transactional<
      ActionResult<OrderDetailResponseDto>
    >(async (em) => {
      const locked = await this.lockOrderAndItems(em, orderId, userId);
      if (locked.order.status === OrderStatus.PENDING_PAYMENT) {
        if (await this.isExpired(em, locked.order)) {
          await this.closeLockedOrder(
            em,
            locked.order,
            OrderCloseReason.PAYMENT_EXPIRED,
          );
          return {
            value: await this.detailProjection(em, locked.order, false),
            expired: true,
          };
        }
        locked.order.status = OrderStatus.PENDING_SHIPMENT;
        locked.order.paidAt = await this.databaseNow(em);
        locked.order.updatedAt = locked.order.paidAt;
        await em.flush();
      } else if (
        locked.order.status !== OrderStatus.PENDING_SHIPMENT &&
        locked.order.status !== OrderStatus.PENDING_RECEIPT &&
        locked.order.status !== OrderStatus.COMPLETED
      ) {
        throw new ConflictException('订单当前状态不能模拟支付');
      }
      return {
        value: await this.detailProjection(em, locked.order, false),
        expired: false,
      };
    });
    if (result.expired) throw new ConflictException('订单已超过支付期限');
    return result.value;
  }

  public async cancelForUser(
    userId: string,
    orderId: string,
  ): Promise<OrderDetailResponseDto> {
    const result = await this.manager().transactional<
      ActionResult<OrderDetailResponseDto>
    >(async (em) => {
      const locked = await this.lockOrderAndItems(em, orderId, userId);
      if (
        locked.order.status === OrderStatus.CLOSED &&
        locked.order.closeReason === OrderCloseReason.USER_CANCELLED
      ) {
        return {
          value: await this.detailProjection(em, locked.order, false),
          expired: false,
        };
      }
      if (locked.order.status !== OrderStatus.PENDING_PAYMENT)
        throw new ConflictException('仅待支付订单可以取消');
      if (await this.isExpired(em, locked.order)) {
        await this.closeLockedOrder(
          em,
          locked.order,
          OrderCloseReason.PAYMENT_EXPIRED,
        );
        return {
          value: await this.detailProjection(em, locked.order, false),
          expired: true,
        };
      }
      await this.closeLockedOrder(
        em,
        locked.order,
        OrderCloseReason.USER_CANCELLED,
      );
      return {
        value: await this.detailProjection(em, locked.order, false),
        expired: false,
      };
    });
    if (result.expired) throw new ConflictException('订单已超过支付期限');
    return result.value;
  }

  public async confirmReceiptForUser(
    userId: string,
    orderId: string,
  ): Promise<OrderDetailResponseDto> {
    return this.manager().transactional(async (em) => {
      const locked = await this.lockOrderAndItems(em, orderId, userId);
      if (locked.order.status === OrderStatus.COMPLETED)
        return this.detailProjection(em, locked.order, false);
      if (locked.order.status !== OrderStatus.PENDING_RECEIPT)
        throw new ConflictException('订单当前状态不能确认收货');
      const now = await this.databaseNow(em);
      locked.order.status = OrderStatus.COMPLETED;
      locked.order.completedAt = now;
      locked.order.updatedAt = now;
      await em.flush();
      return this.detailProjection(em, locked.order, false);
    });
  }

  public async listForAdmin(
    query: AdminOrderQueryDto,
  ): Promise<AdminOrderPageResponseDto> {
    return this.list(
      query,
      {
        ...(query.userId ? { userId: query.userId } : {}),
      },
      true,
    ) as Promise<AdminOrderPageResponseDto>;
  }

  public async getForAdmin(
    orderId: string,
  ): Promise<AdminOrderDetailResponseDto> {
    const em = this.manager();
    const order = await em.findOne(Order, { id: orderId });
    if (!order) throw new NotFoundException('订单不存在');
    return this.detailProjection(em, order, true);
  }

  public async shipForAdmin(
    orderId: string,
    input: ShipOrderInput,
  ): Promise<AdminOrderDetailResponseDto> {
    return this.manager().transactional(async (em) => {
      const locked = await this.lockOrderAndItems(em, orderId);
      if (
        locked.order.status === OrderStatus.PENDING_RECEIPT ||
        locked.order.status === OrderStatus.COMPLETED
      ) {
        if (
          locked.order.shipmentCarrier === input.carrier &&
          locked.order.shipmentTrackingNo === input.trackingNo
        ) {
          return this.detailProjection(em, locked.order, true);
        }
        throw new ConflictException('已发货订单不能更改物流信息');
      }
      if (locked.order.status !== OrderStatus.PENDING_SHIPMENT)
        throw new ConflictException('订单当前状态不能发货');

      await this.catalog.decrementStockForShipment(
        em,
        locked.items.map((item) => ({
          skuId: item.skuId,
          quantity: item.quantity,
        })),
      );
      const now = await this.databaseNow(em);
      locked.order.status = OrderStatus.PENDING_RECEIPT;
      locked.order.shipmentCarrier = input.carrier;
      locked.order.shipmentTrackingNo = input.trackingNo;
      locked.order.shippedAt = now;
      locked.order.updatedAt = now;
      await em.flush();
      return this.detailProjection(em, locked.order, true);
    });
  }

  public async closeExpiredOrder(orderId: string): Promise<boolean> {
    return this.manager().transactional(async (em) => {
      const candidate = await em.findOne(Order, { id: orderId });
      if (!candidate || candidate.status !== OrderStatus.PENDING_PAYMENT)
        return false;
      const items = await em.find(
        OrderItem,
        { orderId },
        { orderBy: { skuId: 'ASC' } },
      );
      await this.catalog.lockSkus(
        em,
        items.map((item) => item.skuId),
      );
      const order = await em.findOne(
        Order,
        { id: orderId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!order || order.status !== OrderStatus.PENDING_PAYMENT) return false;
      if (!(await this.isExpired(em, order))) return false;
      await this.closeLockedOrder(em, order, OrderCloseReason.PAYMENT_EXPIRED);
      return true;
    });
  }

  public async getUnavailableOrderLockSet(
    em: EntityManager,
    changedSkuIds: string[],
  ): Promise<UnavailableOrderLockSet> {
    if (changedSkuIds.length === 0) return { orderIds: [], skuIds: [] };
    const sortedSkuIds = [...new Set(changedSkuIds)].sort((left, right) =>
      left.localeCompare(right),
    );
    const skuPlaceholders = sortedSkuIds.map(() => '?').join(', ');
    const candidateOrders: Array<{ order_id: string }> = await em
      .getConnection()
      .execute<Array<{ order_id: string }>>(
        `select distinct o.id::text as order_id
         from orders o
         join order_items i on i.order_id = o.id
         where o.status = 'pending_payment'
           and i.sku_id in (${skuPlaceholders})
         order by o.id::text asc`,
        sortedSkuIds,
        'all',
        em.getTransactionContext(),
      );
    const orderIds = candidateOrders.map((row) => row.order_id);
    if (orderIds.length === 0) return { orderIds: [], skuIds: [] };
    const skuIds = await em.find(
      OrderItem,
      { orderId: { $in: orderIds } },
      { fields: ['skuId'] },
    );
    return {
      orderIds,
      skuIds: [...new Set(skuIds.map((item) => item.skuId))].sort(
        (left, right) => left.localeCompare(right),
      ),
    };
  }

  public async closePendingOrdersForUnavailableSkus(
    em: EntityManager,
    changedSkuIds: string[],
    lockedSkuIds: string[],
  ): Promise<number> {
    const locked = new Set(lockedSkuIds);
    if (changedSkuIds.some((skuId) => !locked.has(skuId)))
      throw new UnavailableOrderLockSetChangedError();
    const candidate = await this.getUnavailableOrderLockSet(em, changedSkuIds);
    if (candidate.skuIds.some((skuId) => !locked.has(skuId)))
      throw new UnavailableOrderLockSetChangedError();

    let closedCount = 0;
    for (const orderId of candidate.orderIds) {
      const order = await em.findOne(
        Order,
        { id: orderId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!order || order.status !== OrderStatus.PENDING_PAYMENT) continue;
      const items = await em.find(OrderItem, { orderId });
      if (items.some((item) => !locked.has(item.skuId)))
        throw new UnavailableOrderLockSetChangedError();
      await this.closeLockedOrder(
        em,
        order,
        OrderCloseReason.PRODUCT_UNAVAILABLE,
      );
      closedCount += 1;
    }
    return closedCount;
  }

  private async list(
    query: OrderPageQuery,
    ownerFilter: { userId?: string },
    admin: boolean,
  ): Promise<OrderPageResponseDto | AdminOrderPageResponseDto> {
    const em = this.manager();
    const where = {
      ...ownerFilter,
      ...(query.status ? { status: query.status } : {}),
      ...(query.orderNo ? { orderNo: query.orderNo } : {}),
    };
    const [orders, total] = await em.findAndCount(Order, where, {
      orderBy: { createdAt: 'DESC', id: 'DESC' },
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    const itemRows =
      orders.length === 0
        ? []
        : await em.find(OrderItem, {
            orderId: { $in: orders.map((order) => order.id) },
          });
    const counts = new Map<string, number>();
    for (const item of itemRows)
      counts.set(item.orderId, (counts.get(item.orderId) ?? 0) + item.quantity);
    const items = orders.map((order) =>
      this.summaryProjection(order, counts.get(order.id) ?? 0, admin),
    );
    return {
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
    } as OrderPageResponseDto | AdminOrderPageResponseDto;
  }

  private async detailProjection(
    em: EntityManager,
    order: Order,
    admin: false,
  ): Promise<OrderDetailResponseDto>;
  private async detailProjection(
    em: EntityManager,
    order: Order,
    admin: true,
  ): Promise<AdminOrderDetailResponseDto>;
  private async detailProjection(
    em: EntityManager,
    order: Order,
    admin: boolean,
  ): Promise<OrderDetailResponseDto | AdminOrderDetailResponseDto> {
    const items = await em.find(
      OrderItem,
      { orderId: order.id },
      { orderBy: { skuId: 'ASC' } },
    );
    return {
      ...this.summaryProjection(
        order,
        items.reduce((sum, item) => sum + item.quantity, 0),
        admin,
      ),
      items: items.map((item) => this.itemProjection(item)),
      recipient: {
        name: order.recipientName,
        phone: order.recipientPhone,
        address: order.recipientAddress,
      },
      shipment:
        order.shipmentCarrier && order.shipmentTrackingNo
          ? {
              carrier: order.shipmentCarrier,
              trackingNo: order.shipmentTrackingNo,
            }
          : null,
    } as OrderDetailResponseDto | AdminOrderDetailResponseDto;
  }

  private summaryProjection(
    order: Order,
    itemCount: number,
    admin: boolean,
  ): OrderSummaryResponseDto | AdminOrderSummaryResponseDto {
    const common = {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      closeReason: order.closeReason,
      itemsAmount: order.itemsAmount,
      shippingAmount: order.shippingAmount,
      discountAmount: order.discountAmount,
      payableAmount: order.payableAmount,
      currency: 'CNY' as const,
      paymentMode: 'simulated' as const,
      itemCount,
      expiresAt: order.expiresAt.toISOString(),
      createdAt: order.createdAt.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
      shippedAt: order.shippedAt?.toISOString() ?? null,
      completedAt: order.completedAt?.toISOString() ?? null,
      closedAt: order.closedAt?.toISOString() ?? null,
    };
    return admin ? { ...common, userId: order.userId } : common;
  }

  private itemProjection(item: OrderItem): OrderItemResponseDto {
    return {
      skuId: item.skuId,
      productExternalId: item.productExternalId,
      productName: item.productName,
      color: item.color,
      size: item.size,
      imageUrl: item.imageUrl,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineAmount: item.lineAmount,
    };
  }

  private async lockOrderAndItems(
    em: EntityManager,
    orderId: string,
    userId?: string,
  ): Promise<LockedOrder> {
    const candidate = await em.findOne(Order, { id: orderId });
    if (!candidate) throw new NotFoundException('订单不存在');
    const items = await em.find(
      OrderItem,
      { orderId },
      { orderBy: { skuId: 'ASC' } },
    );
    await this.catalog.lockSkus(
      em,
      items.map((item) => item.skuId),
    );
    const order = await em.findOne(
      Order,
      { id: orderId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (!order || (userId !== undefined && order.userId !== userId))
      throw new NotFoundException('订单不存在');
    return { order, items };
  }

  private async closeIfExpired(
    em: EntityManager,
    orderId: string,
  ): Promise<boolean> {
    const candidate = await em.findOne(Order, { id: orderId });
    if (!candidate || candidate.status !== OrderStatus.PENDING_PAYMENT)
      return false;
    const items = await em.find(OrderItem, { orderId });
    await this.catalog.lockSkus(
      em,
      items
        .map((item) => item.skuId)
        .sort((left, right) => left.localeCompare(right)),
    );
    const order = await em.findOne(
      Order,
      { id: orderId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (!order || order.status !== OrderStatus.PENDING_PAYMENT) return false;
    if (!(await this.isExpired(em, order))) return false;
    await this.closeLockedOrder(em, order, OrderCloseReason.PAYMENT_EXPIRED);
    return true;
  }

  private async closeLockedOrder(
    em: EntityManager,
    order: Order,
    reason: OrderCloseReason,
  ): Promise<void> {
    const now = await this.databaseNow(em);
    order.status = OrderStatus.CLOSED;
    order.closeReason = reason;
    order.closedAt = now;
    order.updatedAt = now;
    await em.flush();
  }

  private async isExpired(em: EntityManager, order: Order): Promise<boolean> {
    const now = await this.databaseNow(em);
    return now.getTime() >= order.expiresAt.getTime();
  }

  private async databaseNow(em: EntityManager): Promise<Date> {
    const rows = await em
      .getConnection()
      .execute<Array<{ database_now: Date }>>(
        'select now() as database_now',
        [],
        'all',
        em.getTransactionContext(),
      );
    const value = rows[0]?.database_now;
    if (!value) throw new Error('数据库时间查询未返回结果');
    return new Date(value);
  }

  private async readIdempotentRetry(
    userId: string,
    input: CreateOrderInput,
    requestHash: string,
  ): Promise<CreateOrderResult> {
    return this.manager().transactional(async (em) => {
      const previous = await em.findOne(OrderIdempotency, {
        userId,
        idempotencyKey: input.idempotencyKey,
      });
      if (!previous) throw new ConflictException('创建订单时发生唯一约束冲突');
      if (previous.requestHash !== requestHash)
        throw new ConflictException('幂等键已用于不同的下单请求');
      const order = await em.findOne(Order, { id: previous.orderId });
      if (!order) throw new ConflictException('订单幂等记录不一致');
      await this.closeIfExpired(em, order.id);
      const current = await em.findOneOrFail(Order, { id: order.id });
      return {
        order: await this.detailProjection(em, current, false),
        created: false,
      };
    });
  }

  private hashRequest(input: CreateOrderInput): string {
    const canonical = {
      items: [...input.items]
        .map(({ skuId, quantity }) => ({ skuId, quantity }))
        .sort((left, right) => left.skuId.localeCompare(right.skuId)),
      recipient: {
        name: input.recipient.name,
        phone: input.recipient.phone,
        address: input.recipient.address,
      },
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  private toMinorUnits(amount: string): bigint {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(amount);
    if (!match) throw new ConflictException('商品价格格式无效');
    const fraction = (match[2] ?? '').padEnd(2, '0');
    return BigInt(match[1]!) * 100n + BigInt(fraction || '0');
  }

  private formatMinorUnits(amount: bigint): string {
    return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
  }

  private newOrderNumber(): string {
    return `OD-${Date.now()}-${randomBytes(5).toString('hex')}`;
  }

  private manager(): EntityManager {
    return this.orders.getEntityManager().fork();
  }
}
