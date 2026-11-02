import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import { formatMemoryContext } from '../context/memory-context.formatter.js';
import type { MemoryCategory } from '../context/memory-value.schema.js';
import { UserMemory, UserMemoryStatus } from '../entity/user-memory.entity.js';
import { UserMemorySetting } from '../entity/user-memory-setting.entity.js';

const MAX_ITEMS = 8;
const MAX_CONTEXT_CHARACTERS = 2048;

@Injectable()
export class UserMemoryReaderService {
  public constructor(
    @InjectRepository(UserMemory)
    private readonly memories: EntityRepository<UserMemory>,
    @InjectRepository(UserMemorySetting)
    private readonly settings: EntityRepository<UserMemorySetting>,
  ) {}

  public async readContext(
    userId: string,
    currentMessage: string,
  ): Promise<string> {
    const setting = await this.settings.findOne({ userId });
    if (setting?.enabled === false) return '';

    const rows = await this.memories.find(
      { userId, status: UserMemoryStatus.ACTIVE },
      { orderBy: { isPrimary: 'desc', updatedAt: 'desc' }, limit: 100 },
    );
    const keywords = this.extractKeywords(currentMessage);
    const ranked = rows
      .map((memory) => ({
        memory,
        score: this.score(
          memory.category,
          JSON.stringify(memory.value),
          keywords,
        ),
      }))
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.memory.updatedAt.getTime() - left.memory.updatedAt.getTime(),
      )
      .slice(0, MAX_ITEMS);

    for (let count = ranked.length; count > 0; count -= 1) {
      const context = formatMemoryContext(
        ranked.slice(0, count).map(({ memory }) => ({
          category: memory.category,
          value: memory.value,
          isPrimary: memory.isPrimary,
          updatedAt: memory.updatedAt,
        })),
      );
      if (context.length <= MAX_CONTEXT_CHARACTERS) return context;
    }
    return '';
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
    category: MemoryCategory,
    serializedValue: string,
    keywords: string[],
  ): number {
    const categoryTerms: Record<MemoryCategory, string[]> = {
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
