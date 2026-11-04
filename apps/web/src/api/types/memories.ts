export interface MemorySettings {
  enabled: boolean;
  updatedAt: string;
}

export interface MemoryDocument {
  content: string;
  revision: number;
  updatedAt: string | null;
}
