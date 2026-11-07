import { Injectable, Logger, Inject } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MikroORM, RequestContext } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import { Order } from '../entity/order.entity.js';
import { OrdersService } from './orders.service.js';

const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 50;

@Injectable()
export class OrderExpirationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderExpirationService.name);
  private timer: NodeJS.Timeout | undefined;
  private work: Promise<void> | undefined;
  private stopped = false;
  private nextFailureLogAt = 0;

  public constructor(
    @InjectRepository(Order)
    private readonly orders: EntityRepository<Order>,
    private readonly orderService: OrdersService,
    @Inject(MikroORM) private readonly orm: MikroORM,
  ) {}

  public onModuleInit(): void {
    this.timer = setInterval(() => this.startPoll(), POLL_INTERVAL_MS);
    this.timer.unref();
    this.startPoll();
  }

  public async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.work;
  }

  private startPoll(): void {
    if (this.stopped || this.work) return;
    this.work = RequestContext.create(this.orm.em, () => this.poll()).finally(
      () => {
        this.work = undefined;
      },
    );
  }

  private async poll(): Promise<void> {
    try {
      const candidates = await this.orders
        .getEntityManager()
        .fork()
        .getConnection()
        .execute<Array<{ id: string }>>(
          `select id::text as id
           from orders
           where status = 'pending_payment' and expires_at <= now()
           order by expires_at asc, id asc
           limit ?`,
          [BATCH_SIZE],
          'all',
        );
      for (const order of candidates) {
        if (this.stopped) return;
        try {
          await this.orderService.closeExpiredOrder(order.id);
        } catch {
          this.logFailure();
        }
      }
      this.nextFailureLogAt = 0;
    } catch {
      this.logFailure();
    }
  }

  private logFailure(): void {
    if (Date.now() < this.nextFailureLogAt) return;
    this.nextFailureLogAt = Date.now() + 30_000;
    this.logger.warn('订单超时关闭任务失败 (ORDER_EXPIRATION_FAILED)');
  }
}
