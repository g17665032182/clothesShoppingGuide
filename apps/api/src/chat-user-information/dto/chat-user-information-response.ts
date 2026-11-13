import type { OrderCloseReason, OrderStatus } from '../../orders/index.js';

export type InformationPage<TItem> = {
  items: TItem[];
  page: number;
  pageSize: 5;
  total: number;
};

export type AddressInformationItem = {
  addressId: string;
  isDefault: boolean;
  displayName: string;
};

export type OrderInformationItem = {
  orderNo: string;
  status: OrderStatus;
  closeReason: OrderCloseReason | null;
  itemsAmount: string;
  payableAmount: string;
  itemCount: number;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  completedAt: string | null;
  items: {
    productName: string;
    color: string;
    size: string;
    quantity: number;
  }[];
};

export type SavedPhotoInformationItem = {
  photoId: string;
  kind: 'person';
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  createdAt: string;
  availability: 'saved';
};

export type GetMyInformationSections = {
  addresses?: InformationPage<AddressInformationItem>;
  orders?: InformationPage<OrderInformationItem>;
  photos?: InformationPage<SavedPhotoInformationItem>;
};

export type GetMyInformationResponse = {
  ok: true;
  sections: GetMyInformationSections;
  errors: {
    section: 'addresses' | 'orders' | 'photos';
    code: 'unavailable';
  }[];
};
