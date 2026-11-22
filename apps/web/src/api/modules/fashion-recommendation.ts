import { apiRequest } from '@/api';
import type {
  RecommendationFeedbackPayload,
  RecommendationFeedbackResponse,
  RecommendationProfile,
  RecommendationSettings,
} from '@/api/types/fashion-recommendation';

export function submitRecommendationFeedback(
  token: string,
  payload: RecommendationFeedbackPayload,
  signal?: AbortSignal,
): Promise<RecommendationFeedbackResponse> {
  return apiRequest<RecommendationFeedbackResponse>(
    '/fashion-recommendation/feedback',
    {
      method: 'POST',
      data: payload,
      token,
      signal,
    },
  );
}

export function getRecommendationProfile(
  token: string,
  signal?: AbortSignal,
): Promise<RecommendationProfile> {
  return apiRequest<RecommendationProfile>('/fashion-recommendation/profile', {
    token,
    signal,
  });
}

export function clearRecommendationProfile(
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiRequest<void>('/fashion-recommendation/profile', {
    method: 'DELETE',
    data: { confirm: true },
    token,
    signal,
  });
}

export function getRecommendationSettings(
  token: string,
  signal?: AbortSignal,
): Promise<RecommendationSettings> {
  return apiRequest<RecommendationSettings>(
    '/fashion-recommendation/settings',
    { token, signal },
  );
}

export function updateRecommendationSettings(
  token: string,
  enabled: boolean,
  signal?: AbortSignal,
): Promise<RecommendationSettings> {
  return apiRequest<RecommendationSettings>(
    '/fashion-recommendation/settings',
    {
      method: 'PATCH',
      data: { enabled },
      token,
      signal,
    },
  );
}
