import type { PreferenceResponse } from '../dto/user-preference.dto.js';
import {
  UserPreference,
  UserPreferenceStatus,
} from './user-preference.entity.js';
import { getPreferenceValueType } from '../context/preference-value.schema.js';

export function toPreferenceResponse(
  preference: UserPreference,
): PreferenceResponse {
  if (preference.status !== UserPreferenceStatus.ACTIVE) {
    throw new Error('已删除偏好不得映射为公开响应');
  }

  return {
    id: preference.id,
    category: preference.category,
    valueType: getPreferenceValueType(preference.category),
    value: preference.value,
    isPrimary: preference.isPrimary,
    source: preference.sourceStatus
      ? {
          conversationId: preference.sourceConversationId,
          status: preference.sourceStatus,
        }
      : null,
    createdAt: preference.createdAt.toISOString(),
    updatedAt: preference.updatedAt.toISOString(),
  };
}
