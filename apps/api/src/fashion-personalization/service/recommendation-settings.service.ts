import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import {
  type RecommendationSettingsInput,
  type RecommendationSettingsResponse,
} from '../dto/recommendation-settings.dto.js';
import { RecommendationSetting } from '../entity/recommendation-setting.entity.js';

@Injectable()
export class RecommendationSettingsService {
  public constructor(
    @InjectRepository(RecommendationSetting)
    private readonly settings: EntityRepository<RecommendationSetting>,
  ) {}

  public get(userId: string): Promise<RecommendationSettingsResponse> {
    return this.withSetting(userId);
  }

  public update(
    userId: string,
    input: RecommendationSettingsInput,
  ): Promise<RecommendationSettingsResponse> {
    return this.withSetting(userId, input);
  }

  public async isEnabled(userId: string): Promise<boolean> {
    const setting = await this.settings.findOne({ userId });
    return setting?.enabled ?? true;
  }

  private async withSetting(
    userId: string,
    input?: RecommendationSettingsInput,
  ): Promise<RecommendationSettingsResponse> {
    const em = this.settings.getEntityManager().fork();
    return em.transactional(async (transaction) => {
      await transaction
        .getConnection()
        .execute(
          'select pg_advisory_xact_lock(hashtextextended(?, 0))',
          [`recommendation-profile:${userId}`],
          'run',
          transaction.getTransactionContext(),
        );
      const repository = transaction.getRepository(RecommendationSetting);
      let setting = await repository.findOne({ userId });
      if (!setting) {
        setting = repository.create({
          userId,
          enabled: true,
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
