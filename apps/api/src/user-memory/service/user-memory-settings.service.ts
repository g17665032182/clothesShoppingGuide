import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import { UserMemorySetting } from '../entity/user-memory-setting.entity.js';
import type {
  MemorySettingsResponse,
  UpdateMemorySettingsInput,
} from '../dto/memory-settings.dto.js';

@Injectable()
export class UserMemorySettingsService {
  public constructor(
    @InjectRepository(UserMemorySetting)
    private readonly settings: EntityRepository<UserMemorySetting>,
  ) {}

  public get(userId: string): Promise<MemorySettingsResponse> {
    return this.withSetting(userId);
  }

  public update(
    userId: string,
    input: UpdateMemorySettingsInput,
  ): Promise<MemorySettingsResponse> {
    return this.withSetting(userId, input);
  }

  private async withSetting(
    userId: string,
    input?: UpdateMemorySettingsInput,
  ): Promise<MemorySettingsResponse> {
    const entityManager = this.settings.getEntityManager().fork();
    return entityManager.transactional(async (transaction) => {
      // 开关与文档应用共用本领域锁，关闭返回后旧提取结果不能继续提交。
      await transaction
        .getConnection()
        .execute(
          'select pg_advisory_xact_lock(hashtextextended(?, 0))',
          [`user-memory-document:${userId}`],
          'run',
          transaction.getTransactionContext(),
        );
      const repository = transaction.getRepository(UserMemorySetting);
      let setting = await repository.findOne({ userId });
      if (!setting) {
        setting = repository.create({
          userId,
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        transaction.persist(setting);
      }
      if (input) {
        setting.enabled = input.enabled;
        setting.updatedAt = new Date();
      }
      await transaction.flush();
      return {
        enabled: setting.enabled,
        updatedAt: setting.updatedAt.toISOString(),
      };
    });
  }
}
