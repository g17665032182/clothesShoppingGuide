import { Injectable } from '@nestjs/common';
import { IsolationLevel } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import { formatPreferenceContext } from '../context/preference-context.formatter.js';
import type { PreferenceCategory } from '../context/preference-value.schema.js';
import {
  UserPreference,
  UserPreferenceStatus,
} from '../entity/user-preference.entity.js';
import { UserPreferenceSetting } from '../entity/user-preference-setting.entity.js';
import type { UserPreferencesReader } from '../port/user-preferences.port.js';
import {
  preferenceChatQuerySchema,
  preferenceChatResultSchema,
  type PreferenceChatQuery,
  type PreferenceChatResult,
} from '../dto/preference-chat-query.dto.js';

const MAX_ITEMS = 8;
const MAX_CONTEXT_CHARACTERS = 2048;

@Injectable()
export class UserPreferenceReaderService implements UserPreferencesReader {
  public constructor(
    @InjectRepository(UserPreference)
    private readonly preferences: EntityRepository<UserPreference>,
  ) {}

  public async listForChat(
    userId: string,
    query: PreferenceChatQuery,
  ): Promise<PreferenceChatResult> {
    const input = preferenceChatQuerySchema.parse(query);

    try {
      const entityManager = this.preferences.getEntityManager().fork({
        clear: true,
        useContext: false,
        keepTransactionContext: false,
      });

      // 设置、总数和当页内容共用独立只读快照，避免带入请求中待写的实体。
      return await entityManager.transactional(
        async (em) => {
          const setting = await em.findOne(
            UserPreferenceSetting,
            { userId },
            { fields: ['enabled'] },
          );
          if (setting?.enabled === false) {
            return preferenceChatResultSchema.parse({
              ok: false,
              code: 'preferences_disabled',
            });
          }

          // 缺少设置等同默认开启，但纯查询不能补建设置或启动历史任务。
          const [rows, total] = await em.findAndCount(
            UserPreference,
            {
              userId,
              status: UserPreferenceStatus.ACTIVE,
              deletedAt: null,
              ...(input.category ? { category: input.category } : {}),
            },
            {
              fields: [
                'id',
                'category',
                'valueType',
                'value',
                'isPrimary',
                'updatedAt',
              ],
              orderBy: { isPrimary: 'DESC', updatedAt: 'DESC', id: 'ASC' },
              limit: 5,
              offset: (input.page - 1) * 5,
            },
          );

          return preferenceChatResultSchema.parse({
            ok: true,
            items: rows.map((preference) => ({
              category: preference.category,
              valueType: preference.valueType,
              value: preference.value,
              isPrimary: preference.isPrimary,
              updatedAt: preference.updatedAt.toISOString(),
            })),
            page: input.page,
            pageSize: 5,
            total,
            hasNext: input.page * 5 < total,
          });
        },
        { isolationLevel: IsolationLevel.REPEATABLE_READ, readOnly: true },
      );
    } catch {
      // 查询故障和不安全存量值统一失败，不暴露异常或伪装成没有偏好。
      return { ok: false, code: 'unavailable' };
    }
  }

  public async readContext(
    userId: string,
    currentMessage: string,
  ): Promise<string> {
    const entityManager = this.preferences.getEntityManager().fork();
    const rows = await entityManager.transactional(async (em) => {
      await em
        .getConnection()
        .execute(
          "set local statement_timeout = '5s'",
          [],
          'run',
          em.getTransactionContext(),
        );
      const setting = await em.findOne(UserPreferenceSetting, { userId });
      if (setting?.enabled === false) return [];
      return em.find(
        UserPreference,
        { userId, status: UserPreferenceStatus.ACTIVE },
        { orderBy: { isPrimary: 'desc', updatedAt: 'desc' }, limit: 100 },
      );
    });
    const keywords = this.extractKeywords(currentMessage);
    const ranked = rows
      .map((preference) => ({
        preference,
        score: this.score(
          preference.category,
          JSON.stringify(preference.value),
          keywords,
        ),
      }))
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          Number(right.preference.isPrimary) -
            Number(left.preference.isPrimary) ||
          right.preference.updatedAt.getTime() -
            left.preference.updatedAt.getTime(),
      )
      .slice(0, MAX_ITEMS);

    let structured = '';
    for (let count = ranked.length; count > 0; count -= 1) {
      const context = formatPreferenceContext(
        ranked.slice(0, count).map(({ preference }) => ({
          category: preference.category,
          value: preference.value,
          isPrimary: preference.isPrimary,
          updatedAt: preference.updatedAt,
        })),
      );
      if (context.length <= MAX_CONTEXT_CHARACTERS) {
        structured = context;
        break;
      }
    }
    return structured;
  }

  private extractKeywords(message: string): string[] {
    const normalized = message.toLocaleLowerCase();
    return [
      ...new Set(
        normalized.split(/[^\p{L}\p{N}]+/u).filter((part) => part.length >= 2),
      ),
    ];
  }

  private score(
    category: PreferenceCategory,
    serializedValue: string,
    keywords: string[],
  ): number {
    const categoryTerms: Record<PreferenceCategory, string[]> = {
      size: ['size', '尺码', '尺寸', '上衣', '裤'],
      shoe_size: ['shoe', '鞋', '鞋码'],
      fit: ['fit', '版型', '宽松', '合身', '修身'],
      style: ['style', '风格', '穿搭'],
      color: ['color', '颜色', '配色'],
      occasion: ['occasion', '场合', '通勤', '旅行', '运动'],
      budget: ['budget', '预算', '价格', '价位'],
      avoidance: ['avoid', '不要', '避开', '不喜欢'],
      purchase_preference: ['quality', '购买', '偏好', '性价比'],
    };
    const categoryScore = categoryTerms[category].some((term) =>
      keywords.some(
        (keyword) =>
          term.toLocaleLowerCase().includes(keyword) || keyword.includes(term),
      ),
    )
      ? 3
      : 0;
    const valueScore = keywords.some((keyword) =>
      serializedValue.toLocaleLowerCase().includes(keyword),
    )
      ? 1
      : 0;
    return categoryScore + valueScore;
  }
}
