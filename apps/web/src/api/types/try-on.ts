export type TryOnPhotoKind = 'temporary' | 'saved';
export type TryOnTaskStatus =
  'queued' | 'processing' | 'succeeded' | 'failed' | 'deleted';

export type TryOnProductCategory = 'tops' | 'bottoms' | 'dresses' | 'outerwear';

export interface TryOnPhoto {
  id: string;
  kind: TryOnPhotoKind;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  createdAt: string;
}

export interface TryOnResult {
  resultId: string;
  createdAt: string;
  width: number;
  height: number;
  downloadable: boolean;
}

export interface TryOnTask {
  id: string;
  status: TryOnTaskStatus;
  product: {
    externalId: string;
    name: string;
    category: TryOnProductCategory;
    color: string;
    imageUrl: string | null;
  };
  result: TryOnResult | null;
  notification: { unread: boolean };
  failureCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface TryOnTaskPage {
  items: TryOnTask[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TryOnPhotoPage {
  items: TryOnPhoto[];
  availability:
    'disabled' | 'test_images_unconfigured' | 'test_only' | 'available';
}

export interface UploadTryOnPhotoResponse {
  photo: TryOnPhoto;
}

export interface CreateTryOnTaskPayload {
  productExternalId: string;
  color: string;
  photoId: string;
  consentVersion: string;
}

export interface TryOnDownloadResponse {
  url?: string;
  downloadUrl?: string;
  expiresAt?: string;
  expiresInSeconds?: number;
}

export interface TryOnTaskQuery {
  page?: number;
  pageSize?: number;
  status?: TryOnTaskStatus;
  unread?: boolean;
}
