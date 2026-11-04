export type PreferenceCategory =
  | 'size'
  | 'shoe_size'
  | 'fit'
  | 'style'
  | 'color'
  | 'occasion'
  | 'budget'
  | 'avoidance'
  | 'purchase_preference';

export type PreferenceValue =
  | { garment: string; label: string; system?: string }
  | { value: number; system: string; width?: string }
  | { preference: string; notes?: string }
  | { items: string[] }
  | { mode: 'prefer' | 'avoid'; items: string[] }
  | { currency: 'CNY' | 'USD'; min?: number; max?: number }
  | { terms: string[]; reason?: string };

export interface PreferenceSource {
  conversationId: string | null;
  status: 'active' | 'deleted' | 'unavailable';
}

export interface PreferenceRecord {
  id: string;
  category: PreferenceCategory;
  valueType: 'single' | 'multi' | 'range';
  value: PreferenceValue;
  isPrimary: boolean;
  source: PreferenceSource | null;
  createdAt: string;
  updatedAt: string;
}

export interface PreferenceSettings {
  enabled: boolean;
  updatedAt: string;
}

export interface PreferenceListResponse {
  items: PreferenceRecord[];
  settings: PreferenceSettings;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CreatePreferencePayload {
  category: PreferenceCategory;
  value: PreferenceValue;
  isPrimary?: boolean;
}

export interface UpdatePreferencePayload {
  category?: PreferenceCategory;
  value?: PreferenceValue;
  isPrimary?: boolean;
}

export interface DeleteAllPreferencesResponse {
  deletedCount: number;
}
