export type RecommendationMode = 'item' | 'outfit' | 'both';
export type RecommendationSlot =
  | 'tops'
  | 'bottoms'
  | 'dresses'
  | 'outerwear'
  | 'shoes';
export type RecommendationSourceType = 'local_catalog' | 'online_api' | 'mcp';

export interface FashionRecommendationItem {
  targetRef: string;
  sourceId: string;
  sourceType: RecommendationSourceType;
  sourceName: string;
  externalId: string;
  slot: RecommendationSlot;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  productUrl: string | null;
  price: string | null;
  currency: 'CNY' | null;
  inStock: boolean;
  observedAt: string;
  matchReasons: string[];
}

export interface FashionRecommendationOutfitItem {
  slot: RecommendationSlot;
  targetRef: string;
  item: FashionRecommendationItem;
}

export interface FashionRecommendationOutfit {
  outfitRef: string;
  styleSummary: string;
  items: FashionRecommendationOutfitItem[];
  total: { amount: string; currency: 'CNY' } | null;
  missingSlots: RecommendationSlot[];
}

export interface FashionRecommendationCard {
  type: 'card';
  name: 'outfit_recommendation';
  data: {
    version: 1;
    recommendationId: string;
    mode: RecommendationMode;
    styleSummary: string;
    items: FashionRecommendationItem[];
    outfits: FashionRecommendationOutfit[];
  };
}

export type RecommendationFeedbackType = 'positive' | 'negative' | 'dismissed';
export type RecommendationFeedbackTargetType =
  | 'recommendation'
  | 'outfit'
  | 'slot'
  | 'item';
export type RecommendationFeedbackReason =
  | 'style'
  | 'color'
  | 'price'
  | 'occasion'
  | 'fit'
  | 'too_exaggerated'
  | 'too_plain';

export interface RecommendationFeedbackPayload {
  recommendationId: string;
  conversationId: string;
  assistantMessageId: string;
  targetType: RecommendationFeedbackTargetType;
  targetRef: string;
  feedbackType: RecommendationFeedbackType;
  reasonCode?: RecommendationFeedbackReason;
  note?: string;
}

export type RecommendationFeedbackResponse =
  | { accepted: true; feedbackId: string }
  | { accepted: false; reason: 'learning_disabled' };

export interface RecommendationProfileTag {
  label: string;
  confidence: number;
  evidenceCount: number;
}

export interface RecommendationProfile {
  preferredStyles: RecommendationProfileTag[];
  avoidedStyles: RecommendationProfileTag[];
  preferredOccasions: RecommendationProfileTag[];
  priceSensitivity: string | null;
  silhouetteSignals: RecommendationProfileTag[];
  evidenceCount: number;
  version: number;
  updatedAt: string | null;
  learningEnabled: boolean;
}

export interface RecommendationSettings {
  enabled: boolean;
  updatedAt: string;
}
