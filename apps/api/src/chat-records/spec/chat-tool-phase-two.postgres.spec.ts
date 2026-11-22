import 'reflect-metadata';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import {
  AIMessage,
  AIMessageChunk,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs';
import type { EntityManager, EventArgs, Transaction } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/postgresql';
import {
  Module,
  StandardSchemaValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard.js';
import { createLlmGraph } from '../../llm/graph/llm.graph.js';
import { LlmService } from '../../llm/service/llm.service.js';
import { FakeChatModel } from '../../llm/spec/fakes/fake-chat-model.js';
import config from '../../mikro-orm.config.js';
import { OrderItem } from '../../orders/entity/order-item.entity.js';
import {
  Order,
  OrderCloseReason,
  OrderStatus,
} from '../../orders/entity/order.entity.js';
import { Product } from '../../product-catalog/entity/product.entity.js';
import { ProductSku } from '../../product-catalog/entity/product-sku.entity.js';
import {
  ProductSkuReaderService,
  type ProductSkuLookupResult,
} from '../../product-catalog/index.js';
import { UserMemoryTask } from '../../user-memory/entity/user-memory-task.entity.js';
import { UserMemoryTaskService } from '../../user-memory/service/user-memory-task.service.js';
import {
  getPreferenceValueType,
  type PreferenceCategory,
  type PreferenceValue,
} from '../../user-preferences/context/preference-value.schema.js';
import { UserPreferenceSetting } from '../../user-preferences/entity/user-preference-setting.entity.js';
import {
  UserPreference,
  UserPreferenceStatus,
} from '../../user-preferences/entity/user-preference.entity.js';
import { type PreferenceChatResult } from '../../user-preferences/index.js';
import { UserPreferenceReaderService } from '../../user-preferences/service/user-preference-reader.service.js';
import { User, UserStatus } from '../../users/entity/user.entity.js';
import { UsersService } from '../../users/service/users.service.js';
import { ChatContextService } from '../context/chat-context.service.js';
import { ChatRecordsController } from '../controller/chat-records.controller.js';
import { LlmChatController } from '../controller/llm-chat.controller.js';
import { ChatConversationAccess } from '../conversation-access/index.js';
import { ChatDisplayService } from '../display/chat-display.service.js';
import type { PublicDisplayEnvelope } from '../display/chat-display.types.js';
import { ChatConversation } from '../entity/chat-conversation.entity.js';
import { ChatMessage } from '../entity/chat-message.entity.js';
import {
  ChatTraceEvent,
  ChatTraceEventType,
} from '../entity/chat-trace-event.entity.js';
import { ChatExtractionSourceService } from '../extraction-source/chat-extraction-source.service.js';
import { mapTraceEventsToMessages } from '../history/chat-history.mapper.js';
import {
  ChatRecordsService,
  type ConversationDetailResponse,
} from '../service/chat-records.service.js';
import { eligibleSummaryTraceIds } from '../service/chat-summary-source.js';
import { ChatTraceWriterService } from '../trace/chat-trace-writer.service.js';

const PRIVATE_VALUE = 'phase-two-private-fixture';
const PREFERENCE_VALUE = '集成偏好蓝';
const STRANGER_VALUE = '其他账号偏好红';

/** 复用已有假模型基类，同时驱动实际 JSON/SSE 工具图而不访问外部模型。 */
class PhaseTwoModel extends FakeChatModel {
  public constructor(private readonly productExternalId: string) {
    super();
  }

  private decide(messages: BaseMessage[]): AIMessage {
    this.calls.push(messages);
    const latest = messages.at(-1);
    const id = `model-${randomUUID()}`;
    if (latest instanceof ToolMessage) {
      return new AIMessage({ id, content: '已完成本次只读查询。' });
    }
    const content = String(latest?.content ?? '');
    if (content.includes('普通聊天')) {
      return new AIMessage({ id, content: '继续讨论日常穿搭。' });
    }
    const both = content.includes('同时查询');
    const sku = content.includes('SKU');
    const calls = [];
    if (sku || both) {
      calls.push({
        id: `sku-${randomUUID()}`,
        name: 'get_product_skus',
        args: {
          productExternalId: content.includes('不存在')
            ? `${this.productExternalId}-missing`
            : this.productExternalId,
          color: 'bLaCk',
          size: 'm',
          page: content.includes('空页') ? 10 : 1,
        },
      });
    }
    if (!sku || both) {
      calls.push({
        id: `preference-${randomUUID()}`,
        name: 'get_my_preferences',
        args: {
          category: 'color',
          page: content.includes('空页') ? 10 : 1,
        },
      });
    }
    return new AIMessage({ id, content: '', tool_calls: calls });
  }

  public override async _generate(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
  ): Promise<ChatResult> {
    const message = this.decide(messages);
    return { generations: [{ message, text: String(message.content) }] };
  }

  public override async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
  ): AsyncGenerator<ChatGenerationChunk> {
    const result = this.decide(messages);
    const calls = result.tool_calls ?? [];
    const message = new AIMessageChunk({
      ...(result.id ? { id: result.id } : {}),
      content: String(result.content),
      ...(calls.length
        ? {
            tool_call_chunks: calls.map((call, index) => ({
              type: 'tool_call_chunk' as const,
              index,
              id: call.id!,
              name: call.name,
              args: JSON.stringify(call.args),
            })),
          }
        : {}),
    });
    yield new ChatGenerationChunk({ message, text: String(result.content) });
  }
}

type Frame = { type: string; data: Record<string, unknown> };

function parseFrame(frame: string): Frame {
  const lines = frame.split('\n');
  const event = lines.find((line) => line.startsWith('event: '));
  const data = lines.find((line) => line.startsWith('data: '));
  assert.ok(event);
  assert.ok(data);
  return {
    type: event.slice(7),
    data: JSON.parse(data.slice(6)) as Record<string, unknown>,
  };
}

test(
  '隔离 PostgreSQL：第二阶段只读规格和偏好、真实工具图、JWT 与来源隔离',
  {
    skip: process.env.RUN_CHAT_TOOL_PHASE_TWO_POSTGRES_TEST !== '1',
    timeout: 180_000,
  },
  async (t) => {
    const dbName = process.env.CHAT_TOOL_PHASE_TWO_TEST_DB ?? '';
    assert.match(
      dbName,
      /^clothes_guide_chat_tool_phase_two_test_[a-z0-9_]+$/u,
      '必须显式指定已经创建的第二阶段专用测试库',
    );
    assert.ok(dbName.length <= 63, '测试库名称不得被 PostgreSQL 静默截断');
    assert.notEqual(dbName, config.dbName);
    assert.notEqual(dbName, 'clothes_guide');

    const queries: string[] = [];
    let afterSettingLoaded:
      | ((transaction: EntityManager) => Promise<void>)
      | undefined;
    const orm = await MikroORM.init({
      ...config,
      dbName,
      ensureDatabase: false,
      debug: ['query'],
      logger: (message) => queries.push(message),
      migrations: { ...config.migrations, snapshot: false },
      subscribers: [
        {
          async onLoad(args: EventArgs<UserPreferenceSetting>) {
            if (
              !(args.entity instanceof UserPreferenceSetting) ||
              !afterSettingLoaded
            )
              return;
            const hook = afterSettingLoaded;
            afterSettingLoaded = undefined;
            await hook(args.em);
          },
        },
      ],
    });
    const connection = orm.em.getConnection();
    const nativeExecute = connection.execute;
    const execute = nativeExecute.bind(connection);
    const fixtureUsers = [randomUUID(), randomUUID(), randomUUID()];
    const [ownerId, strangerId, emptyId] = fixtureUsers as [
      string,
      string,
      string,
    ];
    const products = [0, 1, 2].map((index) =>
      Object.assign(new Product(), {
        externalId: `phase-two-${randomUUID()}`,
        name: '第二阶段合成外套',
        category: 'outerwear',
        isActive: index !== 1,
      }),
    );
    const product = products[0]!;
    const skuIds = Array.from({ length: 126 }, () => randomUUID()).sort();
    const snapshotSkuId = randomUUID();
    const snapshotPreferenceId = randomUUID();
    let app: INestApplication | undefined;
    let migrated = false;
    let afterSkuProductRead:
      | ((context: Transaction | undefined) => Promise<void>)
      | undefined;
    const skuContexts: Array<Transaction | undefined> = [];

    try {
      // 不创建数据库；连接目标必须已存在，迁移也只消费显式注入的 dbName。
      const actualDatabase = await execute<Array<{ database: string }>>(
        'select current_database() as database',
      );
      assert.equal(actualDatabase[0]?.database, dbName);
      await orm.migrator.up();
      migrated = true;
      const em = orm.em.fork();
      await em
        .persist(
          fixtureUsers.map((id) =>
            Object.assign(new User(), {
              id,
              email: `${id}@local.invalid`,
              passwordHash: 'non-login-fixture',
              displayName: '第二阶段合成账号',
            }),
          ),
        )
        .flush();
      await em.persist(products).flush();
      const skus = skuIds.map((id, index) =>
        Object.assign(new ProductSku(), {
          id,
          productId: product.id,
          externalSkuId: `phase-two-sku-${index}`,
          color: index >= 118 ? 'Black' : 'White',
          size: index >= 118 ? 'M' : 'L',
          price: `${100 + index}.00`,
          stock: 2,
          imageUrl: `https://local.invalid/${PRIVATE_VALUE}`,
          isActive: index !== 125,
        }),
      );
      await em.persist(skus).flush();
      const matchingSkus = skus.slice(118, 125);
      const reservedSku = matchingSkus[0]!;
      const reservation = Object.assign(new Order(), {
        userId: ownerId,
        orderNo: `phase-two-${randomUUID()}`,
        itemsAmount: (Number(reservedSku.price) * 2).toFixed(2),
        payableAmount: (Number(reservedSku.price) * 2).toFixed(2),
        recipientName: PRIVATE_VALUE,
        recipientPhone: '13800138000',
        recipientAddress: PRIVATE_VALUE,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await em.persist(reservation).flush();
      const reservedItem = Object.assign(new OrderItem(), {
        orderId: reservation.id,
        skuId: reservedSku.id,
        productExternalId: product.externalId,
        productName: product.name,
        color: reservedSku.color,
        size: reservedSku.size,
        unitPrice: reservedSku.price,
        quantity: 2,
        lineAmount: reservation.itemsAmount,
      });
      await em.persist(reservedItem).flush();

      const preferenceValues: Array<[PreferenceCategory, PreferenceValue]> = [
        ['size', { garment: '上衣', label: 'M', system: '国际码' }],
        ['shoe_size', { value: 42, system: 'EU' }],
        ['fit', { preference: '宽松' }],
        ['style', { items: ['简约'] }],
        ['color', { mode: 'prefer', items: [PREFERENCE_VALUE] }],
        ['occasion', { items: ['通勤'] }],
        ['budget', { currency: 'CNY', min: 100, max: 800 }],
        ['avoidance', { terms: ['皮草'] }],
        ['purchase_preference', { items: ['舒适优先'] }],
      ];
      const fixedTime = new Date('2026-11-16T00:00:00.000Z');
      const makePreference = (
        category: PreferenceCategory,
        value: PreferenceValue,
        overrides: Partial<UserPreference> = {},
      ) =>
        Object.assign(new UserPreference(), {
          userId: ownerId,
          category,
          valueType: getPreferenceValueType(category),
          value,
          valueFingerprint: randomUUID(),
          createdAt: fixedTime,
          updatedAt: fixedTime,
          ...overrides,
        });
      const preferences = preferenceValues.map(([category, value], index) =>
        makePreference(category, value, { isPrimary: index === 0 }),
      );
      preferences.push(
        makePreference('style', { items: ['运动'] }),
        makePreference('style', { items: ['休闲'] }),
      );
      const excludedPreferences = [
        makePreference(
          'color',
          { mode: 'prefer', items: [STRANGER_VALUE] },
          {
            userId: strangerId,
          },
        ),
        makePreference(
          'style',
          { items: ['删除状态'] },
          {
            status: UserPreferenceStatus.DELETED,
          },
        ),
        makePreference(
          'style',
          { items: ['软删除'] },
          {
            deletedAt: fixedTime,
          },
        ),
      ];
      await em.persist([...preferences, ...excludedPreferences]).flush();
      const colorPreference = preferences.find(
        (row) => row.category === 'color',
      )!;
      const shoePreference = preferences.find(
        (row) => row.category === 'shoe_size',
      )!;
      const skuReader = new ProductSkuReaderService(em.getRepository(Product));
      const preferenceReader = new UserPreferenceReaderService(
        em.getRepository(UserPreference),
      );
      const readSkus = (page = 1) =>
        skuReader.listForChat({
          productExternalId: product.externalId,
          color: 'bLaCk',
          size: 'm',
          page,
        });
      const enablePreferences = async (enabled: boolean) => {
        const settingsEm = orm.em.fork();
        const existing = await settingsEm.findOne(UserPreferenceSetting, {
          userId: ownerId,
        });
        if (existing) {
          existing.enabled = enabled;
          await settingsEm.flush();
        } else {
          await settingsEm
            .persist(
              Object.assign(new UserPreferenceSetting(), {
                userId: ownerId,
                enabled,
              }),
            )
            .flush();
        }
      };
      const fixtureSnapshot = async () =>
        JSON.stringify({
          products: await orm.em
            .fork()
            .find(
              Product,
              { id: { $in: products.map((row) => row.id) } },
              { orderBy: { id: 'asc' } },
            ),
          skus: await orm.em
            .fork()
            .find(
              ProductSku,
              { productId: product.id },
              { orderBy: { id: 'asc' } },
            ),
          order: await orm.em.fork().findOne(Order, { id: reservation.id }),
          items: await orm.em.fork().find(OrderItem, {
            orderId: reservation.id,
          }),
          preferences: await orm.em
            .fork()
            .find(
              UserPreference,
              { userId: { $in: fixtureUsers } },
              { orderBy: { id: 'asc' } },
            ),
          settings: await orm.em
            .fork()
            .find(
              UserPreferenceSetting,
              { userId: { $in: fixtureUsers } },
              { orderBy: { userId: 'asc' } },
            ),
        });

      // 包装真实 SQL 执行只用于观测与插入并发提交点，不替换任何查询结果。
      connection.execute = (async (
        ...args: Parameters<typeof connection.execute>
      ) => {
        const result = await execute(...args);
        const sql = typeof args[0] === 'string' ? args[0] : '';
        const skuRead =
          /select id::text as id\s+from products/u.test(sql) ||
          /from product_skus s/u.test(sql);
        if (skuRead) skuContexts.push(args[3]);
        if (
          /select id::text as id\s+from products/u.test(sql) &&
          afterSkuProductRead
        ) {
          const hook = afterSkuProductRead;
          afterSkuProductRead = undefined;
          await hook(args[3]);
        }
        return result;
      }) as typeof connection.execute;

      await t.test(
        '真实 SKU 超一百条先筛选后分页，预占状态、重复组合和空页准确',
        async () => {
          const before = await fixtureSnapshot();
          skuContexts.length = 0;
          const first = await readSkus();
          const second = await readSkus(2);
          assert.equal(first.ok, true);
          assert.equal(second.ok, true);
          if (!first.ok || !second.ok) return;
          assert.equal(first.total, 7);
          assert.equal(second.total, 7);
          assert.equal(first.hasNext, true);
          assert.equal(second.hasNext, false);
          assert.deepEqual(
            [...first.items, ...second.items].map((row) => row.unitPrice),
            matchingSkus.map((row) => row.price),
          );
          assert.equal(first.items[0]?.inStock, false);
          assert.equal(
            first.items.slice(1).every((row) => row.inStock),
            true,
          );
          for (const item of [...first.items, ...second.items]) {
            assert.deepEqual(
              Object.keys(item).sort(),
              ['color', 'size', 'unitPrice', 'currency', 'inStock'].sort(),
            );
            assert.equal(item.color, 'Black');
            assert.equal(item.size, 'M');
          }
          assert.equal(skuContexts.length, 6);
          assert.ok(skuContexts[0]);
          assert.equal(
            skuContexts
              .slice(0, 3)
              .every((context) => context === skuContexts[0]),
            true,
          );
          assert.ok(skuContexts[3]);
          assert.equal(
            skuContexts
              .slice(3, 6)
              .every((context) => context === skuContexts[3]),
            true,
          );
          const unfiltered = await skuReader.listForChat({
            productExternalId: product.externalId,
            page: 10,
          });
          assert.equal(unfiltered.ok, true);
          if (unfiltered.ok) {
            assert.equal(unfiltered.total, 125);
            assert.equal(unfiltered.items.length, 5);
            assert.equal(unfiltered.hasNext, true);
          }
          assert.deepEqual(await readSkus(10), {
            ok: true,
            productExternalId: product.externalId,
            items: [],
            page: 10,
            pageSize: 5,
            total: 7,
            hasNext: false,
          });
          const noMatch = await skuReader.listForChat({
            productExternalId: product.externalId,
            color: 'Black',
            size: 'L',
            page: 1,
          });
          assert.equal(noMatch.ok, true);
          if (noMatch.ok) assert.equal(noMatch.total, 0);
          for (const productExternalId of [
            products[1]!.externalId,
            `${product.externalId}-missing`,
          ]) {
            assert.deepEqual(
              await skuReader.listForChat({ productExternalId, page: 1 }),
              { ok: false, code: 'not_found' },
            );
          }
          const empty = await skuReader.listForChat({
            productExternalId: products[2]!.externalId,
            page: 1,
          });
          assert.equal(empty.ok, true);
          if (empty.ok) assert.equal(empty.total, 0);
          assert.equal(await fixtureSnapshot(), before);
        },
      );

      await t.test(
        'SKU 原生 SQL 真实只读 RR，另一连接提交后同次查询保持旧计数及预占',
        async () => {
          let proof: Array<{ isolation: string; readonly: string }> = [];
          afterSkuProductRead = async (context) => {
            assert.ok(context, '原生查询必须显式绑定本次事务');
            proof = await execute(
              "select current_setting('transaction_isolation') as isolation, current_setting('transaction_read_only') as readonly",
              [],
              'all',
              context,
            );
            const concurrent = orm.em.fork();
            await concurrent.transactional(async (transaction) => {
              await transaction.nativeUpdate(
                Order,
                { id: reservation.id },
                {
                  status: OrderStatus.CLOSED,
                  closeReason: OrderCloseReason.USER_CANCELLED,
                  closedAt: new Date(),
                },
              );
              await transaction.nativeUpdate(
                ProductSku,
                { id: reservedSku.id },
                { price: '777.00' },
              );
              transaction.persist(
                Object.assign(new ProductSku(), {
                  id: snapshotSkuId,
                  productId: product.id,
                  externalSkuId: `snapshot-${randomUUID()}`,
                  color: 'Black',
                  size: 'M',
                  price: '778.00',
                  stock: 1,
                }),
              );
            });
          };
          try {
            const original = await readSkus();
            assert.deepEqual(proof, [
              {
                isolation: 'repeatable read',
                readonly: 'on',
              },
            ]);
            assert.equal(original.ok, true);
            if (!original.ok) return;
            assert.equal(original.total, 7);
            assert.equal(original.items[0]?.unitPrice, reservedSku.price);
            assert.equal(original.items[0]?.inStock, false);
            const next = await readSkus();
            assert.equal(next.ok, true);
            if (!next.ok) return;
            assert.equal(next.total, 8);
            const reserved = next.items.find(
              (item) => item.unitPrice === '777.00',
            );
            // 新增 UUID 的位置可不同，按完整两页寻找原来被预占的规格。
            const nextSecond = await readSkus(2);
            assert.equal(nextSecond.ok, true);
            if (nextSecond.ok) {
              const updated =
                reserved ??
                nextSecond.items.find((item) => item.unitPrice === '777.00');
              assert.equal(updated?.inStock, true);
            }
          } finally {
            afterSkuProductRead = undefined;
            await orm.em.fork().nativeDelete(ProductSku, {
              id: snapshotSkuId,
            });
            await orm.em
              .fork()
              .nativeUpdate(
                ProductSku,
                { id: reservedSku.id },
                { price: reservedSku.price },
              );
            await orm.em.fork().nativeUpdate(
              Order,
              { id: reservation.id },
              {
                status: OrderStatus.PENDING_PAYMENT,
                closeReason: null,
                closedAt: null,
              },
            );
          }
        },
      );

      await t.test(
        '偏好九类、本人和双删除过滤、主偏好及稳定分页，缺设置保持只读',
        async () => {
          const before = await fixtureSnapshot();
          const first = await preferenceReader.listForChat(ownerId, {
            page: 1,
          });
          const second = await preferenceReader.listForChat(ownerId, {
            page: 2,
          });
          const third = await preferenceReader.listForChat(ownerId, {
            page: 3,
          });
          assert.ok(first.ok && second.ok && third.ok);
          if (!first.ok || !second.ok || !third.ok) return;
          assert.equal(first.total, 11);
          const actual = [...first.items, ...second.items, ...third.items];
          const expected = [...preferences].sort(
            (a, b) =>
              Number(b.isPrimary) - Number(a.isPrimary) ||
              b.updatedAt.valueOf() - a.updatedAt.valueOf() ||
              a.id.localeCompare(b.id),
          );
          assert.deepEqual(
            actual.map((row) => row.value),
            expected.map((row) => row.value),
          );
          assert.equal(actual[0]?.isPrimary, true);
          for (const [category, value] of preferenceValues) {
            const result = await preferenceReader.listForChat(ownerId, {
              category,
              page: 1,
            });
            assert.equal(result.ok, true);
            if (!result.ok) continue;
            assert.equal(result.total, category === 'style' ? 3 : 1);
            assert.ok(
              result.items.some((item) => isDeepStrictEqual(item.value, value)),
            );
            assert.equal(
              result.items.every(
                (item) =>
                  item.category === category &&
                  item.valueType === getPreferenceValueType(category),
              ),
              true,
            );
            for (const item of result.items) {
              assert.deepEqual(
                Object.keys(item).sort(),
                [
                  'category',
                  'valueType',
                  'value',
                  'isPrimary',
                  'updatedAt',
                ].sort(),
              );
            }
          }
          const stranger = await preferenceReader.listForChat(strangerId, {
            category: 'color',
            page: 1,
          });
          assert.equal(stranger.ok, true);
          if (stranger.ok) {
            assert.equal(stranger.total, 1);
            assert.ok(JSON.stringify(stranger).includes(STRANGER_VALUE));
            assert.equal(
              JSON.stringify(stranger).includes(PREFERENCE_VALUE),
              false,
            );
          }
          const empty = await preferenceReader.listForChat(emptyId, {
            page: 1,
          });
          assert.equal(empty.ok, true);
          if (empty.ok) assert.equal(empty.total, 0);
          assert.equal(
            await orm.em.fork().count(UserPreferenceSetting, {
              userId: { $in: fixtureUsers },
            }),
            0,
          );
          assert.equal(await fixtureSnapshot(), before);
        },
      );

      await t.test(
        '偏好关闭不读条目或写入，坏值与类型冲突整次失败',
        async () => {
          await enablePreferences(false);
          const before = await fixtureSnapshot();
          queries.length = 0;
          assert.deepEqual(
            await preferenceReader.listForChat(ownerId, { page: 1 }),
            { ok: false, code: 'preferences_disabled' },
          );
          const disabledQueries = [...queries];
          assert.equal(
            disabledQueries.some((query) =>
              /from "user_preferences"/u.test(query),
            ),
            false,
          );
          assert.doesNotMatch(
            disabledQueries.join('\n'),
            /\b(insert|update|delete)\b/iu,
          );
          assert.equal(await fixtureSnapshot(), before);
          await enablePreferences(true);
          for (const overrides of [
            { valueType: 'single' as const },
            { value: { mode: 'prefer', items: ['13800138000'] } as never },
            { value: { unrelated: PRIVATE_VALUE } as never },
          ]) {
            try {
              await orm.em
                .fork()
                .nativeUpdate(
                  UserPreference,
                  { id: colorPreference.id },
                  overrides,
                );
              assert.deepEqual(
                await preferenceReader.listForChat(ownerId, {
                  category: 'color',
                  page: 1,
                }),
                { ok: false, code: 'unavailable' },
              );
            } finally {
              await orm.em.fork().nativeUpdate(
                UserPreference,
                { id: colorPreference.id },
                {
                  valueType: colorPreference.valueType,
                  value: colorPreference.value,
                },
              );
            }
          }
        },
      );

      await t.test(
        '偏好设置与条目处于真实只读 RR，下一查询重新读取关闭及新数据',
        async () => {
          let proof: Array<{ isolation: string; readonly: string }> = [];
          afterSettingLoaded = async (transaction) => {
            assert.ok(transaction.getTransactionContext());
            proof = await transaction
              .getConnection()
              .execute(
                "select current_setting('transaction_isolation') as isolation, current_setting('transaction_read_only') as readonly",
                [],
                'all',
                transaction.getTransactionContext(),
              );
            await orm.em.fork().transactional(async (concurrent) => {
              await concurrent.nativeUpdate(
                UserPreferenceSetting,
                { userId: ownerId },
                { enabled: false },
              );
              await concurrent.nativeUpdate(
                UserPreference,
                { id: shoePreference.id },
                { value: { value: 43, system: 'EU' } },
              );
              concurrent.persist(
                Object.assign(new UserPreference(), {
                  id: snapshotPreferenceId,
                  userId: ownerId,
                  category: 'shoe_size',
                  valueType: 'single',
                  value: { value: 44, system: 'EU' },
                  valueFingerprint: randomUUID(),
                }),
              );
            });
          };
          try {
            const original = await preferenceReader.listForChat(ownerId, {
              category: 'shoe_size',
              page: 1,
            });
            assert.deepEqual(proof, [
              {
                isolation: 'repeatable read',
                readonly: 'on',
              },
            ]);
            assert.equal(original.ok, true);
            if (!original.ok) return;
            assert.equal(original.total, 1);
            assert.deepEqual(original.items[0]?.value, shoePreference.value);
            assert.deepEqual(
              await preferenceReader.listForChat(ownerId, {
                category: 'shoe_size',
                page: 1,
              }),
              { ok: false, code: 'preferences_disabled' },
            );
            await enablePreferences(true);
            const next = await preferenceReader.listForChat(ownerId, {
              category: 'shoe_size',
              page: 1,
            });
            assert.equal(next.ok, true);
            if (next.ok) {
              assert.equal(next.total, 2);
              assert.ok(
                next.items.some((item) =>
                  isDeepStrictEqual(item.value, { value: 43, system: 'EU' }),
                ),
              );
            }
          } finally {
            afterSettingLoaded = undefined;
            await orm.em.fork().nativeDelete(UserPreference, {
              id: snapshotPreferenceId,
            });
            await orm.em
              .fork()
              .nativeUpdate(
                UserPreference,
                { id: shoePreference.id },
                { value: shoePreference.value },
              );
            await enablePreferences(true);
          }
        },
      );

      const llmConfig = new ConfigService({
        LLM_MODEL: 'phase-two-fake',
        LLM_CONTEXT_WINDOW_TOKENS: '65536',
        LLM_TOKEN_ENCODING: 'cl100k_base',
      });
      const model = new PhaseTwoModel(product.externalId);
      const llm = new LlmService(createLlmGraph(model), llmConfig, (tools) =>
        createLlmGraph(model, tools),
      );
      const users = new UsersService(em.getRepository(User));
      const source = new ChatExtractionSourceService(
        em.getRepository(ChatConversation),
        users,
      );
      const memoryTasks = new UserMemoryTaskService(
        em.getRepository(UserMemoryTask),
        source,
      );
      let enqueued = 0;
      let failingTool: 'sku' | 'preference' | undefined;
      const traces = em.getRepository(ChatTraceEvent);
      const display = new ChatDisplayService(traces, {
        getTryOnProducts: async () => new Map(),
      } as never);
      const inactivePurchase = {
        fingerprint: '',
        active: false,
        context: '',
        reference: null,
      };
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
          enqueueInTransaction: async (transaction, input) => {
            enqueued++;
            await memoryTasks.enqueueInTransaction(transaction, input);
          },
        },
        { markConversationDeleted: async () => undefined },
        display,
        {
          readContext: async () => '',
          listForChat: async (
            ...args: Parameters<UserPreferenceReaderService['listForChat']>
          ) => {
            if (failingTool === 'preference') throw new Error(PRIVATE_VALUE);
            return preferenceReader.listForChat(...args);
          },
        },
        {} as never,
        {
          runState: async () => inactivePurchase,
          runStateInTransaction: async () => inactivePurchase,
        } as never,
        new ChatConversationAccess(),
        {
          listForChat: async (
            ...args: Parameters<ProductSkuReaderService['listForChat']>
          ) => {
            if (failingTool === 'sku') throw new Error(PRIVATE_VALUE);
            return skuReader.listForChat(...args);
          },
        } as ProductSkuReaderService,
      );
      for (const controller of [LlmChatController, ChatRecordsController]) {
        Reflect.defineMetadata(
          'design:paramtypes',
          [ChatRecordsService],
          controller,
        );
      }
      @Module({
        controllers: [LlmChatController, ChatRecordsController],
        providers: [{ provide: ChatRecordsService, useValue: chat }],
      })
      class PhaseTwoHttpFixture {}
      app = await NestFactory.create(PhaseTwoHttpFixture, {
        logger: false,
        abortOnError: false,
      });
      // 请求串行清空共享测试 EM，保留与生产请求一致的 identity map 边界。
      app.use((_request: unknown, _response: unknown, next: () => void) => {
        em.clear();
        next();
      });
      const jwt = new JwtService({ secret: 'phase-two-test-only' });
      app.useGlobalGuards(new JwtAuthGuard(jwt, new Reflector(), users));
      app.useGlobalPipes(new StandardSchemaValidationPipe());
      app.setGlobalPrefix('api');
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      const token = await jwt.signAsync({ sub: ownerId });
      const strangerToken = await jwt.signAsync({ sub: strangerId });
      const request = (
        path: string,
        body?: unknown,
        bearer: string | null = token,
      ) =>
        fetch(`${base}/api${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            'content-type': 'application/json',
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(20_000),
        });
      const body = (content: string, conversationId?: string) => ({
        ...(conversationId ? { conversationId } : {}),
        messages: [{ role: 'user', content }],
      });
      const excludedTurns: Array<{
        conversationId: string;
        userMessageId: string;
        assistantMessageId: string;
      }> = [];
      const resumeConversations = new Map<string, string>();
      const assertPersisted = async (conversationId: string, toolCount = 1) => {
        const messages = await orm.em
          .fork()
          .find(ChatMessage, { conversationId });
        assert.equal(messages.length, 2);
        assert.equal(
          messages.every((message) => !message.memoryExtractionEligible),
          true,
        );
        assert.equal(
          await orm.em.fork().count(UserMemoryTask, { conversationId }),
          0,
        );
        const user = messages.find((message) => message.role === 'user')!;
        const assistant = messages.find(
          (message) => message.role === 'assistant',
        )!;
        excludedTurns.push({
          conversationId,
          userMessageId: user.id,
          assistantMessageId: assistant.id,
        });
        const rows = await orm.em
          .fork()
          .find(
            ChatTraceEvent,
            { conversationId },
            { orderBy: { sequence: 'asc' } },
          );
        assert.equal(
          rows.filter((row) => row.eventType === ChatTraceEventType.INPUT)
            .length,
          1,
        );
        assert.equal(
          rows.filter(
            (row) => row.eventType === ChatTraceEventType.MODEL_RESPONSE,
          ).length,
          2,
        );
        for (const eventType of [
          ChatTraceEventType.TOOL_CALL,
          ChatTraceEventType.TOOL_RESULT,
        ]) {
          assert.equal(
            rows.filter((row) => row.eventType === eventType).length,
            toolCount,
          );
        }
        const serialized = JSON.stringify(rows);
        for (const value of [
          PRIVATE_VALUE,
          PREFERENCE_VALUE,
          STRANGER_VALUE,
          product.externalId,
          ...skuIds,
          ...preferences.map((row) => row.id),
        ]) {
          assert.equal(serialized.includes(value), false);
        }
        for (const row of rows.filter(
          (item) => item.eventType === ChatTraceEventType.TOOL_RESULT,
        )) {
          assert.doesNotMatch(
            JSON.stringify([row.content, row.payload]),
            /unitPrice|valueType|Black|image|reserved_quantity|skuId/u,
          );
        }
        const final = rows.at(-1)!;
        const envelope = (final.payload as Record<string, unknown>)
          .publicDisplay as PublicDisplayEnvelope;
        assert.equal(envelope.assistantMessageId, assistant.id);
        assert.notEqual(final.messageId, assistant.id);
        assert.equal(envelope.cards.length, 0);
        assert.equal(envelope.forms?.length ?? 0, 0);
        for (const activity of envelope.activities) {
          if (activity.type === 'tool') {
            assert.equal(activity.input, null);
            assert.equal(activity.output, null);
          }
        }
        const history = mapTraceEventsToMessages(rows);
        assert.equal(
          history.some(({ message }) => message instanceof ToolMessage),
          false,
        );
        assert.equal(
          history.some(
            ({ message }) =>
              message instanceof AIMessage &&
              (message.tool_calls?.length ?? 0) > 0,
          ),
          false,
        );
        assert.equal(eligibleSummaryTraceIds(rows, messages).size, 0);
        return rows;
      };
      const readFeedback = (callStart: number) => {
        const messages = model.calls
          .slice(callStart)
          .flat()
          .filter(
            (message): message is ToolMessage => message instanceof ToolMessage,
          );
        const unique = new Map(
          messages.map((message) => [message.tool_call_id, message]),
        );
        return [...unique.values()].map((message) => {
          const result = JSON.parse(String(message.content)) as
            | ProductSkuLookupResult
            | PreferenceChatResult;
          assert.equal(JSON.stringify(result).includes(PRIVATE_VALUE), false);
          return result;
        });
      };

      await t.test('JWT、未知 Body 和跨账号会话在开流前拒绝', async () => {
        assert.equal(
          (await request('/llm/chat', body('查询SKU'), null)).status,
          401,
        );
        assert.equal(
          (
            await request('/llm/chat/stream', {
              ...body('查询SKU'),
              userId: strangerId,
            })
          ).status,
          400,
        );
        const conversation = Object.assign(new ChatConversation(), {
          userId: ownerId,
          title: '第二阶段权限夹具',
        });
        await orm.em.fork().persist(conversation).flush();
        assert.equal(
          (
            await request(
              '/llm/chat/stream',
              body('查询偏好', conversation.id),
              strangerToken,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              `/chat/conversations/${conversation.id}`,
              undefined,
              strangerToken,
            )
          ).status,
          404,
        );
        try {
          await orm.em
            .fork()
            .nativeUpdate(
              User,
              { id: strangerId },
              { status: UserStatus.DISABLED },
            );
          assert.equal(
            (await request('/llm/chat', body('查询偏好'), strangerToken))
              .status,
            401,
          );
        } finally {
          await orm.em
            .fork()
            .nativeUpdate(
              User,
              { id: strangerId },
              { status: UserStatus.ACTIVE },
            );
        }
      });

      const cases = [
        { kind: 'sku', mode: '成功' },
        { kind: 'sku', mode: '空页' },
        { kind: 'sku', mode: '不存在' },
        { kind: 'sku', mode: '故障' },
        { kind: 'preference', mode: '成功' },
        { kind: 'preference', mode: '空页' },
        { kind: 'preference', mode: '关闭' },
        { kind: 'preference', mode: '损坏' },
        { kind: 'preference', mode: '故障' },
      ] as const;
      for (const stream of [false, true]) {
        await t.test(
          `${stream ? 'SSE' : 'JSON'} 真实工具往返覆盖成功、空页、固定失败及整轮来源资格`,
          async () => {
            for (const scenario of cases) {
              failingTool =
                scenario.mode === '故障' ? scenario.kind : undefined;
              await enablePreferences(scenario.mode !== '关闭');
              if (scenario.mode === '损坏') {
                await orm.em
                  .fork()
                  .nativeUpdate(
                    UserPreference,
                    { id: colorPreference.id },
                    { value: { mode: 'prefer', items: ['13800138000'] } },
                  );
              }
              const callStart = model.calls.length;
              const before = await fixtureSnapshot();
              try {
                const response = await request(
                  `/llm/chat${stream ? '/stream' : ''}`,
                  body(
                    `查询${scenario.kind === 'sku' ? 'SKU' : '偏好'}${scenario.mode}；我也喜欢棉料`,
                  ),
                );
                assert.equal(response.status, stream ? 200 : 201);
                let conversationId = '';
                if (stream) {
                  assert.match(
                    response.headers.get('content-type') ?? '',
                    /text\/event-stream/u,
                  );
                  assert.ok(response.body);
                  const reader = response.body.getReader();
                  const decoder = new TextDecoder();
                  const frames: Frame[] = [];
                  let pending = '';
                  while (true) {
                    const chunk = await reader.read();
                    pending += decoder.decode(chunk.value, {
                      stream: !chunk.done,
                    });
                    let end: number;
                    while ((end = pending.indexOf('\n\n')) !== -1) {
                      const frame = parseFrame(pending.slice(0, end));
                      pending = pending.slice(end + 2);
                      frames.push(frame);
                      if (frame.type === 'done') {
                        assert.equal(
                          typeof frame.data.conversationId,
                          'string',
                        );
                        conversationId = frame.data.conversationId as string;
                        // 收到 done 即从另一 EM 检查提交，不能只检查流结束后的最终状态。
                        await assertPersisted(conversationId);
                      }
                    }
                    if (chunk.done) break;
                  }
                  assert.equal(pending, '');
                  assert.equal(frames[0]?.type, 'start');
                  assert.equal(frames.at(-1)?.type, 'done');
                  assert.equal(
                    frames.some((frame) =>
                      [
                        'error',
                        'card',
                        'form',
                        'purchase-form',
                        'try-on-status',
                      ].includes(frame.type),
                    ),
                    false,
                  );
                  for (const frame of frames.filter(
                    (item) => item.type === 'activity',
                  )) {
                    const activity = frame.data.activity as {
                      input: unknown;
                      output: unknown;
                    };
                    assert.equal(activity.input, null);
                    assert.equal(activity.output, null);
                  }
                  assert.equal(
                    JSON.stringify(frames).includes(PREFERENCE_VALUE),
                    false,
                  );
                  assert.equal(
                    JSON.stringify(frames).includes(product.externalId),
                    false,
                  );
                } else {
                  const output = (await response.json()) as {
                    conversationId: string;
                    content: string;
                    cards: unknown[];
                  };
                  conversationId = output.conversationId;
                  assert.equal(output.content, '已完成本次只读查询。');
                  assert.equal(output.cards.length, 0);
                  await assertPersisted(conversationId);
                }
                assert.ok(conversationId);
                const results = readFeedback(callStart);
                assert.equal(results.length, 1);
                const result = results[0]!;
                if (scenario.mode === '关闭') {
                  assert.deepEqual(result, {
                    ok: false,
                    code: 'preferences_disabled',
                  });
                } else if (scenario.mode === '不存在') {
                  assert.deepEqual(result, { ok: false, code: 'not_found' });
                } else if (
                  scenario.mode === '故障' ||
                  scenario.mode === '损坏'
                ) {
                  assert.deepEqual(result, { ok: false, code: 'unavailable' });
                } else {
                  assert.equal(result.ok, true);
                  if (result.ok) {
                    assert.equal(result.total, scenario.kind === 'sku' ? 7 : 1);
                    assert.equal(
                      result.items.length,
                      scenario.mode === '空页'
                        ? 0
                        : scenario.kind === 'sku'
                          ? 5
                          : 1,
                    );
                    if (
                      scenario.kind === 'preference' &&
                      scenario.mode === '成功'
                    ) {
                      assert.ok(
                        JSON.stringify(result).includes(PREFERENCE_VALUE),
                      );
                      assert.equal(
                        JSON.stringify(result).includes(STRANGER_VALUE),
                        false,
                      );
                    }
                  }
                }
                if (!stream && scenario.mode === '成功') {
                  resumeConversations.set(scenario.kind, conversationId);
                }
                assert.equal(enqueued, 0);
                assert.equal(await fixtureSnapshot(), before);
              } finally {
                failingTool = undefined;
                await enablePreferences(true);
                if (scenario.mode === '损坏') {
                  await orm.em
                    .fork()
                    .nativeUpdate(
                      UserPreference,
                      { id: colorPreference.id },
                      { value: colorPreference.value },
                    );
                }
              }
            }
          },
        );
      }

      await t.test('并行两种查询只标记本轮，换账号读取本人记录', async () => {
        let callStart = model.calls.length;
        const both = await request('/llm/chat', body('同时查询SKU和偏好'));
        assert.equal(both.status, 201);
        const output = (await both.json()) as { conversationId: string };
        await assertPersisted(output.conversationId, 2);
        assert.equal(readFeedback(callStart).length, 2);
        callStart = model.calls.length;
        const stranger = await request(
          '/llm/chat',
          body('查询偏好成功'),
          strangerToken,
        );
        assert.equal(stranger.status, 201);
        const otherOutput = (await stranger.json()) as {
          conversationId: string;
        };
        await assertPersisted(otherOutput.conversationId);
        const [result] = readFeedback(callStart);
        assert.equal(result?.ok, true);
        assert.ok(JSON.stringify(result).includes(STRANGER_VALUE));
        assert.equal(JSON.stringify(result).includes(PREFERENCE_VALUE), false);
        assert.equal(enqueued, 0);
      });

      await t.test(
        '两类查询下一普通轮恢复，混合提取/旧候选重试/摘要及公开历史排除工具来源',
        async () => {
          for (const kind of ['sku', 'preference']) {
            const conversationId = resumeConversations.get(kind);
            assert.ok(conversationId);
            const callStart = model.calls.length;
            const response = await request(
              '/llm/chat',
              body('普通聊天：我喜欢舒适面料', conversationId),
            );
            assert.equal(response.status, 201);
            await response.json();
            const calls = model.calls.slice(callStart);
            assert.equal(calls.length, 1);
            assert.equal(
              calls[0]!.some(
                (message) =>
                  message instanceof ToolMessage ||
                  (message instanceof AIMessage &&
                    (message.tool_calls?.length ?? 0) > 0),
              ),
              false,
            );
            const messages = await orm.em
              .fork()
              .find(
                ChatMessage,
                { conversationId },
                { orderBy: { createdAt: 'asc' } },
              );
            assert.equal(messages.length, 4);
            const eligible = messages.filter(
              (message) => message.memoryExtractionEligible,
            );
            assert.equal(eligible.length, 2);
            const ordinaryTurn = {
              userMessageId: eligible.find(
                (message) => message.role === 'user',
              )!.id,
              assistantMessageId: eligible.find(
                (message) => message.role === 'assistant',
              )!.id,
            };
            const excluded = excludedTurns.find(
              (turn) => turn.conversationId === conversationId,
            )!;
            assert.equal(
              await source.readTurn({ userId: ownerId, ...excluded }),
              null,
            );
            const mixed = await source.readTurns({
              userId: ownerId,
              conversationId,
              turns: [excluded, ordinaryTurn],
            });
            assert.deepEqual(
              mixed?.map((turn) => turn.userMessageId),
              [ordinaryTurn.userMessageId],
            );
            assert.equal(
              await source.readTurn({ userId: ownerId, ...excluded }),
              null,
            );
            const queued = await orm.em
              .fork()
              .find(UserMemoryTask, { conversationId });
            assert.equal(queued.length, 1);
            assert.deepEqual(queued[0]?.sourceTurns, [ordinaryTurn]);
            const rows = await orm.em
              .fork()
              .find(
                ChatTraceEvent,
                { conversationId },
                { orderBy: { createdAt: 'asc', sequence: 'asc' } },
              );
            const allowed = eligibleSummaryTraceIds(rows, messages);
            assert.ok(allowed.size > 0);
            const excludedFinal = rows.find(
              (row) =>
                (
                  row.payload as {
                    publicDisplay?: { assistantMessageId?: string };
                  } | null
                )?.publicDisplay?.assistantMessageId ===
                excluded.assistantMessageId,
            )!;
            for (const row of rows.filter(
              (row) => row.runId === excludedFinal.runId,
            )) {
              assert.equal(
                allowed.has(
                  `${row.runId}:${row.messageId ?? `trace-${row.sequence}`}`,
                ),
                false,
              );
            }
            const history = await request(
              `/chat/conversations/${conversationId}?page=1&pageSize=20`,
            );
            assert.equal(history.status, 200);
            const detail = (await history.json()) as ConversationDetailResponse;
            assert.equal(detail.messages.items.length, 4);
            assert.equal(
              JSON.stringify(detail).includes(PREFERENCE_VALUE),
              false,
            );
            assert.equal(
              JSON.stringify(detail).includes(product.externalId),
              false,
            );
          }
          assert.equal(enqueued, 2);
        },
      );
      t.diagnostic(
        '仅合成数据和受控 fake 模型，未注册 Worker/调度器/真实存储或模型供应商；本套件不覆盖登录态浏览器',
      );
    } finally {
      afterSkuProductRead = undefined;
      afterSettingLoaded = undefined;
      connection.execute = nativeExecute;
      try {
        await app?.close();
      } finally {
        try {
          if (migrated) {
            await orm.em.fork().transactional(async (cleanup) => {
              const conversations = await cleanup.find(ChatConversation, {
                userId: { $in: fixtureUsers },
              });
              const conversationIds = conversations.map((row) => row.id);
              if (conversationIds.length) {
                await cleanup.nativeDelete(UserMemoryTask, {
                  conversationId: { $in: conversationIds },
                });
                await cleanup.nativeDelete(ChatTraceEvent, {
                  conversationId: { $in: conversationIds },
                });
                await cleanup.nativeDelete(ChatMessage, {
                  conversationId: { $in: conversationIds },
                });
                await cleanup.nativeDelete(ChatConversation, {
                  id: { $in: conversationIds },
                });
              }
              const orders = await cleanup.find(Order, {
                userId: { $in: fixtureUsers },
              });
              if (orders.length) {
                const orderIds = orders.map((row) => row.id);
                await cleanup.nativeDelete(OrderItem, {
                  orderId: { $in: orderIds },
                });
                await cleanup.nativeDelete(Order, { id: { $in: orderIds } });
              }
              await cleanup.nativeDelete(ProductSku, {
                productId: { $in: products.map((row) => row.id) },
              });
              await cleanup.nativeDelete(Product, {
                id: { $in: products.map((row) => row.id) },
              });
              await cleanup.nativeDelete(UserPreference, {
                userId: { $in: fixtureUsers },
              });
              await cleanup.nativeDelete(UserPreferenceSetting, {
                userId: { $in: fixtureUsers },
              });
              await cleanup.nativeDelete(User, { id: { $in: fixtureUsers } });
            });
          }
        } finally {
          await orm.close();
        }
      }
    }
  },
);
