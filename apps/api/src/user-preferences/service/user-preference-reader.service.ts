import { Injectable } from '@nestjs/common';
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

const MAX_ITEMS = 8;
const MAX_CONTEXT_CHARACTERS = 2048;

@Injectable()
export class UserPreferenceReaderService implements UserPreferencesReader {
  public constructor(
    @InjectRepository(UserPreference)
    private readonly preferences: EntityRepository<UserPreference>,
  ) {}

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
