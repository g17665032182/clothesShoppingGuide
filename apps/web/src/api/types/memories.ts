export type MemoryCategory =
  | 'size'
  | 'shoe_size'
  | 'fit'
  | 'style'
  | 'color'
  | 'occasion'
  | 'budget'
  | 'avoidance'
  | 'purchase_preference';

export type MemoryValue =
  | {
      garment: 'top' | 'bottom' | 'dress' | 'outerwear' | 'unknown';
      label: string;
      system?: 'CN' | 'US' | 'EU' | 'UK' | 'INT' | 'OTHER';
    }
  | {
      value: number;
      system: 'CN' | 'US' | 'EU' | 'UK';
      width?: 'narrow' | 'regular' | 'wide';
    }
  | {
      preference: 'loose' | 'regular' | 'slim';
      notes?: string;
    }
  | {
      items: string[];
    }
  | {
      mode: 'prefer' | 'avoid';
      items: string[];
    }
  | {
      currency: 'CNY' | 'USD';
      min?: number;
      max?: number;
    }
  | {
      terms: string[];
      reason?: string;
    };

export interface MemorySource {
  conversationId: string | null;
  status: 'active' | 'deleted' | 'unavailable';
}

export interface MemoryRecord {
  id: string;
  category: MemoryCategory;
  valueType: 'single' | 'multi' | 'range';
  value: MemoryValue;
  isPrimary: boolean;
  source: MemorySource | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemorySettings {
  enabled: boolean;
  updatedAt: string;
}

export interface MemoryListResponse {
  items: MemoryRecord[];
  settings: MemorySettings;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CreateMemoryPayload {
  category: MemoryCategory;
  value: MemoryValue;
  isPrimary?: boolean;
}

export interface UpdateMemoryPayload {
  category?: MemoryCategory;
  value?: MemoryValue;
  isPrimary?: boolean;
}

export interface DeleteAllMemoriesResponse {
  deletedCount: number;
}

export interface MemoryDocument {
  content: string;
  revision: number;
  updatedAt: string | null;
}
