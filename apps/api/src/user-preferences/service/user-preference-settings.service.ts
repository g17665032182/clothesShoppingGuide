import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import { UserPreferenceSetting } from '../entity/user-preference-setting.entity.js';
import type {
  PreferenceSettingsResponse,
  UpdatePreferenceSettingsInput,
} from '../dto/preference-settings.dto.js';
import { lockPreferenceUser } from '../task/preference-user-lock.js';

@Injectable()
export class UserPreferenceSettingsService {
  public constructor(
    @InjectRepository(UserPreferenceSetting)
    private readonly settings: EntityRepository<UserPreferenceSetting>,
  ) {}

  public async getSettings(
    userId: string,
  ): Promise<PreferenceSettingsResponse> {
    return this.write(userId);
  }

  public async updateSettings(
    userId: string,
    input: UpdatePreferenceSettingsInput,
  ): Promise<PreferenceSettingsResponse> {
    return this.write(userId, input.enabled);
  }

  private async write(
    userId: string,
    enabled?: boolean,
  ): Promise<PreferenceSettingsResponse> {
    return this.settings
      .getEntityManager()
      .fork()
      .transactional(async (em) => {
        await lockPreferenceUser(em, userId);
        const repository = em.getRepository(UserPreferenceSetting);
        let setting = await repository.findOne({ userId });
        if (!setting) {
          setting = repository.create({
            userId,
            enabled: enabled ?? true,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          em.persist(setting);
        } else if (enabled !== undefined) {
          setting.enabled = enabled;
          setting.updatedAt = new Date();
        }
        await em.flush();
        return {
          enabled: setting.enabled,
          updatedAt: setting.updatedAt.toISOString(),
        };
      });
  }
}
