import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { MikroORM } from '@mikro-orm/postgresql';
import { ConfigService } from '@nestjs/config';
import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import config from '../../mikro-orm.config.js';
import { User } from '../../users/entity/user.entity.js';
import { Product } from '../../product-catalog/entity/product.entity.js';
import { ProductSku } from '../../product-catalog/entity/product-sku.entity.js';
import { ProductCatalogPurchaseService } from '../../product-catalog/service/product-catalog-purchase.service.js';
import { ProductCatalogOrderService } from '../../product-catalog/service/product-catalog-order.service.js';
import { ProductCatalogService } from '../../product-catalog/index.js';
import { Order, OrdersService } from '../../orders/index.js';
import { OrderIdempotency } from '../../orders/entity/order-idempotency.entity.js';
import { OrdersController } from '../../orders/controller/orders.controller.js';
import { ChatConversation } from '../../chat-records/entity/chat-conversation.entity.js';
import { ChatMessage } from '../../chat-records/entity/chat-message.entity.js';
import { ChatTraceEvent } from '../../chat-records/entity/chat-trace-event.entity.js';
import { ChatRecordsService } from '../../chat-records/service/chat-records.service.js';
import { ChatDisplayService } from '../../chat-records/display/chat-display.service.js';
import { ChatTraceWriterService } from '../../chat-records/trace/chat-trace-writer.service.js';
import { ChatContextService } from '../../chat-records/context/chat-context.service.js';
import { ChatConversationAccess } from '../../chat-records/conversation-access/index.js';
import { LlmChatController } from '../../chat-records/controller/llm-chat.controller.js';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard.js';
import { FakeChatModel } from '../../llm/spec/fakes/fake-chat-model.js';
import { LlmService } from '../../llm/service/llm.service.js';
import { createLlmGraph } from '../../llm/graph/llm.graph.js';
import { ChatPurchaseDraft } from '../entity/chat-purchase-draft.entity.js';
import { PurchaseDraftService } from '../service/purchase-draft.service.js';
import { PurchaseConfirmationService } from '../service/purchase-confirmation.service.js';
import { PurchaseProjectionService } from '../service/purchase-projection.service.js';
import { ChatPurchaseController } from '../controller/chat-purchase.controller.js';
import type { PurchaseDraftResponse } from '../dto/chat-purchase-response.js';

test(
  '隔离 PostgreSQL：购买生命周期、原子确认、竞争、HTTP/fake 模型及记忆隔离',
  {
    skip: process.env.RUN_CHAT_PURCHASE_POSTGRES_TEST !== '1',
    timeout: 120_000,
  },
  async (t) => {
    const dbName = process.env.CHAT_PURCHASE_TEST_DB ?? '';
    assert.match(dbName, /^clothes_guide_chat_purchase_test_[a-z0-9_]+$/u);
    assert.notEqual(dbName, config.dbName);
    const orm = await MikroORM.init({
      ...config,
      dbName,
      debug: false,
      migrations: { ...config.migrations, snapshot: false },
    });
    try {
      await orm.migrator.up();
      const em = orm.em.fork();
      const owner = Object.assign(new User(), {
        email: `${randomUUID()}@local.invalid`,
        passwordHash: 'non-login-fixture',
        displayName: '购买测试',
      });
      const stranger = Object.assign(new User(), {
        email: `${randomUUID()}@local.invalid`,
        passwordHash: 'non-login-fixture',
        displayName: '隔离测试',
      });
      const product = Object.assign(new Product(), {
        externalId: `purchase-${randomUUID()}`,
        name: '测试衬衫',
        category: 'tops',
      });
      em.persist([owner, stranger, product]);
      await em.flush();
      const sku = Object.assign(new ProductSku(), {
        productId: product.id,
        externalSkuId: 'white-m',
        color: '白色',
        size: 'M',
        price: '39.90',
        stock: 100,
      });
      const conversation = Object.assign(new ChatConversation(), {
        userId: owner.id,
        title: '购买回归',
      });
      em.persist([sku, conversation]);
      await em.flush();
      const access = new ChatConversationAccess(),
        stock = new ProductCatalogOrderService();
      const orders = new OrdersService(em.getRepository(Order), stock);
      const projection = new PurchaseProjectionService();
      const drafts = new PurchaseDraftService(
        em.getRepository(ChatPurchaseDraft),
        access,
        new ProductCatalogPurchaseService(),
        stock,
        projection,
        orders,
      );
      const confirmations = new PurchaseConfirmationService(
        drafts,
        projection,
        orders,
        orders,
      );
      const deletion = new ChatRecordsService(
        em.getRepository(ChatConversation),
        em.getRepository(ChatMessage),
        em.getRepository(ChatTraceEvent),
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        { markConversationDeleted: async () => undefined },
        {} as never,
        {} as never,
        {} as never,
        drafts,
        access,
      );
      const recipient = {
        name: '测试收件人',
        phone: '13800000000',
        address: '测试地址 1 号',
      };
      const newConversation = async () => {
        const row = Object.assign(new ChatConversation(), {
          userId: owner.id,
          title: '购买竞争',
        });
        await orm.em.fork().persist(row).flush();
        return row.id;
      };
      const ready = async (conversationId: string) => {
        const result = await drafts.start(owner.id, conversationId, {
          productExternalId: product.externalId,
          expectedVersion: null,
        });
        return drafts.patch(owner.id, conversationId, result.draft.id, {
          expectedVersion: result.draft.version,
          recipient,
        });
      };

      await t.test(
        '同时 start 只有一份活跃草稿、本人隔离及同值不续期',
        async () => {
          const starts = await Promise.allSettled(
            [0, 1].map(() =>
              drafts.start(owner.id, conversation.id, {
                productExternalId: product.externalId,
                expectedVersion: null,
              }),
            ),
          );
          assert.equal(
            starts.filter((result) => result.status === 'fulfilled').length,
            1,
          );
          const first = (await drafts.read(owner.id, conversation.id)).draft!;
          assert.equal(first.skuId, sku.id);
          const same = await drafts.patch(owner.id, conversation.id, first.id, {
            expectedVersion: first.version,
            quantity: 1,
          });
          assert.equal(same.expiresAt, first.expiresAt);
          assert.equal(same.version, first.version);
          await assert.rejects(drafts.read(stranger.id, conversation.id), {
            status: 404,
          });
          await assert.rejects(
            drafts.patch(stranger.id, conversation.id, first.id, {
              expectedVersion: first.version,
              quantity: 2,
            }),
            { status: 404 },
          );
        },
      );
      await t.test(
        '变价提交只刷新版本，不建单；同版本重试和订单状态恢复唯一',
        async () => {
          const draft = await ready(await newConversation());
          await orm.em
            .fork()
            .nativeUpdate(ProductSku, { id: sku.id }, { price: '40.00' });
          await assert.rejects(
            confirmations.confirm(
              owner.id,
              draft.conversationId,
              draft.id,
              draft.version,
            ),
            { status: 409 },
          );
          assert.equal(
            await orm.em.fork().count(Order, { userId: owner.id }),
            0,
          );
          const refreshed = (await drafts.read(owner.id, draft.conversationId))
            .draft!;
          assert.ok(refreshed.version > draft.version);
          assert.equal(refreshed.confirmation?.unitPrice, '40.00');
          const outcomes = await Promise.all(
            [0, 1].map(() =>
              confirmations.confirm(
                owner.id,
                draft.conversationId,
                draft.id,
                refreshed.version,
              ),
            ),
          );
          assert.equal(outcomes[0]!.order.id, outcomes[1]!.order.id);
          assert.equal(outcomes.filter((outcome) => outcome.created).length, 1);
          await orders.simulatePayment(owner.id, outcomes[0]!.order.id);
          await orm.em
            .fork()
            .nativeUpdate(ProductSku, { id: sku.id }, { isActive: false });
          const replay = await confirmations.confirm(
            owner.id,
            draft.conversationId,
            draft.id,
            refreshed.version,
          );
          assert.equal(replay.order.status, 'pending_shipment');
          assert.equal(replay.created, false);
          await orm.em
            .fork()
            .nativeUpdate(ProductSku, { id: sku.id }, { isActive: true });
        },
      );
      await t.test(
        '有效修改续期，放弃到期草稿只提交 expired 状态',
        async () => {
          const draft = await ready(await newConversation());
          const earlierExpiry = new Date(Date.now() + 60_000);
          await orm.em
            .fork()
            .nativeUpdate(
              ChatPurchaseDraft,
              { id: draft.id },
              { expiresAt: earlierExpiry },
            );
          const changed = await drafts.patch(
            owner.id,
            draft.conversationId,
            draft.id,
            {
              expectedVersion: draft.version,
              quantity: 2,
            },
          );
          assert.ok(Date.parse(changed.expiresAt) > earlierExpiry.getTime());
          await orm.em
            .fork()
            .nativeUpdate(
              ChatPurchaseDraft,
              { id: draft.id },
              { expiresAt: new Date(Date.now() - 1000) },
            );
          await assert.rejects(
            drafts.discard(
              owner.id,
              draft.conversationId,
              draft.id,
              changed.version,
            ),
            { status: 409 },
          );
          const stored = await orm.em
            .fork()
            .findOneOrFail(ChatPurchaseDraft, draft.id);
          assert.equal(stored.status, 'expired');
          assert.equal(stored.confirmation, null);
        },
      );
      await t.test('等待 SKU 锁跨草稿期限后禁止写入', async () => {
        const draft = await ready(await newConversation());
        await orm.em
          .fork()
          .nativeUpdate(
            ChatPurchaseDraft,
            { id: draft.id },
            { expiresAt: new Date(Date.now() + 150) },
          );
        let release!: () => void, acquired!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const locked = new Promise<void>((resolve) => {
          acquired = resolve;
        });
        const holder = orm.em.fork().transactional(async (transaction) => {
          await stock.lockSkus(transaction, [sku.id]);
          acquired();
          await gate;
        });
        await locked;
        const confirmation = confirmations.confirm(
          owner.id,
          draft.conversationId,
          draft.id,
          draft.version,
        );
        const rejected = assert.rejects(confirmation, { status: 409 });
        await new Promise((resolve) => setTimeout(resolve, 250));
        release();
        await holder;
        await rejected;
        const current = (await drafts.read(owner.id, draft.conversationId))
          .draft!;
        assert.equal(current.status, 'expired');
        assert.equal(current.orderId, null);
      });
      await t.test(
        '事务中途失败回滚正式订单、明细、幂等和草稿关联',
        async () => {
          const draft = await ready(await newConversation());
          const failing = new PurchaseConfirmationService(
            drafts,
            projection,
            {
              createConfirmedInTransaction: async (
                ...args: Parameters<
                  OrdersService['createConfirmedInTransaction']
                >
              ) => {
                await orders.createConfirmedInTransaction(...args);
                throw new Error('controlled rollback');
              },
            },
            orders,
          );
          const before = await orm.em.fork().count(Order, { userId: owner.id });
          await assert.rejects(
            failing.confirm(
              owner.id,
              draft.conversationId,
              draft.id,
              draft.version,
            ),
            /controlled rollback/u,
          );
          assert.equal(
            await orm.em.fork().count(Order, { userId: owner.id }),
            before,
          );
          assert.equal(
            (await drafts.read(owner.id, draft.conversationId)).draft?.status,
            'ready',
          );
          assert.equal(
            await orm.em.fork().count(OrderIdempotency, {
              idempotencyKey: (
                await orm.em.fork().findOneOrFail(ChatPurchaseDraft, draft.id)
              ).submissionKey,
            }),
            0,
          );
        },
      );
      await t.test(
        '确认先获锁则删除保留订单，删除先获锁则确认返回 404',
        async () => {
          const first = await ready(await newConversation());
          let release!: () => void, created!: () => void;
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          const creation = new Promise<void>((resolve) => {
            created = resolve;
          });
          const held = new PurchaseConfirmationService(
            drafts,
            projection,
            {
              createConfirmedInTransaction: async (
                ...args: Parameters<
                  OrdersService['createConfirmedInTransaction']
                >
              ) => {
                const result = await orders.createConfirmedInTransaction(
                  ...args,
                );
                created();
                await gate;
                return result;
              },
            },
            orders,
          );
          const confirmation = held.confirm(
            owner.id,
            first.conversationId,
            first.id,
            first.version,
          );
          await creation;
          const deleting = deletion.deleteForUser(
            owner.id,
            first.conversationId,
          );
          release();
          const submitted = await confirmation;
          await deleting;
          assert.equal(
            (await orders.getForUser(owner.id, submitted.order.id)).id,
            submitted.order.id,
          );
          assert.equal(
            await orm.em.fork().count(ChatPurchaseDraft, { id: first.id }),
            0,
          );

          const second = await ready(await newConversation());
          let unlock!: () => void, deleted!: () => void;
          const deleteGate = new Promise<void>((resolve) => {
            unlock = resolve;
          });
          const deletionStarted = new Promise<void>((resolve) => {
            deleted = resolve;
          });
          const deleteFirst = orm.em
            .fork()
            .transactional(async (transaction) => {
              await access.lockOwnedInTransaction(
                transaction,
                owner.id,
                second.conversationId,
              );
              await transaction.nativeDelete(ChatConversation, {
                id: second.conversationId,
                userId: owner.id,
              });
              deleted();
              await deleteGate;
            });
          await deletionStarted;
          const rejected = assert.rejects(
            confirmations.confirm(
              owner.id,
              second.conversationId,
              second.id,
              second.version,
            ),
            { status: 404 },
          );
          unlock();
          await deleteFirst;
          await rejected;
          assert.equal(
            await orm.em.fork().count(ChatPurchaseDraft, { id: second.id }),
            0,
          );
        },
      );
      await t.test(
        '同版本修改与确认竞争只能成功一个，另一请求不会覆盖已提交草稿',
        async () => {
          const draft = await ready(await newConversation());
          const outcomes = await Promise.allSettled([
            confirmations.confirm(
              owner.id,
              draft.conversationId,
              draft.id,
              draft.version,
            ),
            drafts.patch(owner.id, draft.conversationId, draft.id, {
              expectedVersion: draft.version,
              quantity: 2,
            }),
          ]);
          assert.equal(
            outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
            1,
          );
          const stored = (await drafts.read(owner.id, draft.conversationId))
            .draft!;
          if (stored.status === 'submitted') assert.equal(stored.quantity, 1);
          else assert.equal(stored.quantity, 2);
        },
      );
      await t.test(
        '带 JWT 的 HTTP + 真工具图保存 JSON/SSE/历史引用，购买轮次不排队记忆',
        async () => {
          const conversationId = await newConversation();
          const started = await drafts.start(owner.id, conversationId, {
            productExternalId: product.externalId,
            expectedVersion: null,
          });
          const model = new FakeChatModel({
            responses: [
              {
                response: '',
                toolCalls: [
                  {
                    id: 'purchase-update',
                    name: 'update_purchase_draft',
                    args: {
                      draftId: started.draft.id,
                      expectedVersion: started.draft.version,
                      recipient,
                    },
                  },
                ],
              },
              { response: '请查看确认信息。' },
            ],
            chunks: ['请查看确认信息。'],
          });
          const llmConfig = new ConfigService({
            LLM_MODEL: 'purchase-fake',
            LLM_CONTEXT_WINDOW_TOKENS: '65536',
          });
          const llm = new LlmService(
            createLlmGraph(model),
            llmConfig,
            (tools) => createLlmGraph(model, tools),
          );
          let enqueued = 0;
          const traces = em.getRepository(ChatTraceEvent);
          const chat = new ChatRecordsService(
            em.getRepository(ChatConversation),
            em.getRepository(ChatMessage),
            traces,
            llm,
            new ChatContextService(llmConfig, llm),
            { summarize: async () => null } as never,
            new ChatTraceWriterService(traces),
            { readContext: async () => '' },
            {
              enqueueInTransaction: async () => {
                enqueued += 1;
              },
            } as never,
            { markConversationDeleted: async () => undefined },
            new ChatDisplayService(traces),
            { readContext: async () => '' },
            new ProductCatalogService(em.getRepository(Product), llmConfig),
            drafts,
            access,
          );
          Reflect.defineMetadata(
            'design:paramtypes',
            [ChatRecordsService],
            LlmChatController,
          );
          @Module({
            controllers: [
              ChatPurchaseController,
              LlmChatController,
              OrdersController,
            ],
            providers: [
              { provide: PurchaseDraftService, useValue: drafts },
              { provide: PurchaseConfirmationService, useValue: confirmations },
              { provide: ChatRecordsService, useValue: chat },
              { provide: OrdersService, useValue: orders },
            ],
          })
          class PurchaseHttpFixture {}
          const app = await NestFactory.create(PurchaseHttpFixture, {
            logger: false,
            abortOnError: false,
          });
          const jwt = new JwtService({ secret: 'purchase-postgres-test' });
          app.useGlobalGuards(
            new JwtAuthGuard(jwt, new Reflector(), {
              findActiveById: async (id: string) =>
                id === owner.id ? owner : null,
            } as never),
          );
          app.useGlobalPipes(new StandardSchemaValidationPipe());
          app.setGlobalPrefix('api');
          await app.listen(0, '127.0.0.1');
          const token = await jwt.signAsync({ sub: owner.id }),
            base = await app.getUrl();
          const request = (path: string, body?: unknown) =>
            fetch(`${base}/api${path}`, {
              method: body === undefined ? 'GET' : 'POST',
              headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
              },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
          try {
            const response = await request('/llm/chat', {
              conversationId,
              messages: [{ role: 'user', content: '请更新本次收货信息' }],
            });
            assert.equal(response.status, 201);
            const output = (await response.json()) as {
              purchase: { draftId: string; version: number };
              finalTraceSequence?: unknown;
            };
            assert.equal(output.purchase.draftId, started.draft.id);
            assert.equal(output.finalTraceSequence, undefined);
            assert.equal(enqueued, 0);
            assert.equal(
              await orm.em.fork().count(ChatMessage, {
                conversationId,
                memoryExtractionEligible: false,
              }),
              2,
            );
            const traceRows = await orm.em
              .fork()
              .find(ChatTraceEvent, { conversationId });
            const serialized = JSON.stringify(traceRows);
            assert.equal(serialized.includes(recipient.phone), false);
            assert.equal(serialized.includes(recipient.address), false);
            assert.ok(
              model.calls.some((messages) =>
                messages.some((message) => message.type === 'tool'),
              ),
            );
            const state = (await (
              await request(
                `/chat/conversations/${conversationId}/purchase-draft`,
              )
            ).json()) as { draft: PurchaseDraftResponse };
            assert.equal(state.draft.status, 'ready');
            const confirmed = await request(
              `/chat/conversations/${conversationId}/purchase-draft/${state.draft.id}/confirm`,
              { expectedVersion: state.draft.version },
            );
            assert.equal(confirmed.status, 201);
            const order = (
              (await confirmed.json()) as { order: { id: string } }
            ).order;
            assert.equal(
              (await request(`/orders/${order.id}/simulate-payment`, {}))
                .status,
              200,
            );
            await orders.shipForAdmin(order.id, {
              carrier: '测试物流',
              trackingNo: 'TEST-123',
            });
            assert.equal(
              (await request(`/orders/${order.id}/confirm-receipt`, {})).status,
              200,
            );
            const stream = await request('/llm/chat/stream', {
              conversationId,
              messages: [{ role: 'user', content: '查看当前购买' }],
            });
            const text = await stream.text();
            assert.ok(text.indexOf('event: purchase') > 0);
            assert.ok(
              text.indexOf('event: purchase') < text.indexOf('event: done'),
            );
            const history = await chat.getForUser(owner.id, conversationId, {
              normalizedPage: 1,
              normalizedPageSize: 20,
              offset: 0,
            } as never);
            assert.equal(
              history.messages.items
                .filter((message) => message.role === 'assistant')
                .every(
                  (message) => message.purchase?.draftId === state.draft.id,
                ),
              true,
            );
            const replacementConversation = await newConversation();
            const initialDraft = (
              await drafts.start(owner.id, replacementConversation, {
                productExternalId: product.externalId,
                expectedVersion: null,
              })
            ).draft;
            const replacement = Object.assign(new Product(), {
              externalId: `replacement-${randomUUID()}`,
              name: '测试替换商品',
              category: 'tops',
            });
            await orm.em.fork().persist(replacement).flush();
            await orm.em
              .fork()
              .persist(
                Object.assign(new ProductSku(), {
                  productId: replacement.id,
                  externalSkuId: 'replacement-m',
                  color: '黑色',
                  size: 'M',
                  price: '29.00',
                  stock: 10,
                }),
              )
              .flush();
            const events = await chat.prepareStream(owner, {
              conversationId: replacementConversation,
              messages: [{ role: 'user', content: '继续当前购买' }],
            } as never);
            const iterator = events[Symbol.asyncIterator]();
            assert.equal((await iterator.next()).value.type, 'start');
            const replaced = await drafts.start(
              owner.id,
              replacementConversation,
              {
                productExternalId: replacement.externalId,
                expectedVersion: initialDraft.version,
              },
            );
            assert.notEqual(replaced.draft.id, initialDraft.id);
            const received = [];
            for await (const event of {
              [Symbol.asyncIterator]: () => iterator,
            })
              received.push(event);
            const purchaseEvent = received.find(
              (event) => event.type === 'purchase',
            );
            assert.equal(
              purchaseEvent?.type === 'purchase' &&
                purchaseEvent.purchase.draftId,
              initialDraft.id,
            );
            await chat.deleteForUser(owner.id, conversationId);
            assert.equal(
              await orm.em.fork().count(ChatPurchaseDraft, { conversationId }),
              0,
            );
            assert.equal(
              (await orders.getForUser(owner.id, order.id)).status,
              'completed',
            );
            await assert.rejects(
              drafts.start(owner.id, conversationId, {
                productExternalId: product.externalId,
                expectedVersion: null,
              }),
              { status: 404 },
            );
          } finally {
            await app.close();
          }
        },
      );
    } finally {
      await orm.close();
    }
  },
);
