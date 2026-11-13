import { Injectable } from '@nestjs/common';

import { OrdersService, type OrderStatus } from '../../orders/index.js';
import { UserAddressesService } from '../../user-addresses/index.js';
import type { GetMyInformationInput } from '../dto/chat-user-information.schema.js';
import type {
  AddressInformationItem,
  GetMyInformationResponse,
  InformationPage,
  OrderInformationItem,
  SavedPhotoInformationItem,
} from '../dto/chat-user-information-response.js';
import { TryOnPhotoService } from '../../virtual-try-on/index.js';

const INFORMATION_PAGE_SIZE = 5 as const;

@Injectable()
export class ChatUserInformationService {
  public constructor(
    private readonly addresses: UserAddressesService,
    private readonly orders: OrdersService,
    private readonly photos: TryOnPhotoService,
  ) {}

  public async lookup(
    boundUserId: string,
    input: GetMyInformationInput,
  ): Promise<GetMyInformationResponse> {
    const sections: GetMyInformationResponse['sections'] = {};
    const errors: GetMyInformationResponse['errors'] = [];
    const results = await Promise.all(
      input.sections.map(async (section) => {
        try {
          if (section === 'addresses') {
            return {
              section,
              result: await this.readAddresses(boundUserId, input.page),
            };
          }
          if (section === 'orders') {
            return {
              section,
              result: await this.readOrders(boundUserId, input),
            };
          }
          return {
            section,
            result: await this.readPhotos(boundUserId, input.page),
          };
        } catch {
          return { section, result: null };
        }
      }),
    );

    for (const { section, result } of results) {
      if (section === 'addresses') {
        if (result === null) errors.push({ section, code: 'unavailable' });
        else sections.addresses = result;
      } else if (section === 'orders') {
        if (result === null) errors.push({ section, code: 'unavailable' });
        else sections.orders = result;
      } else if (result === null) {
        errors.push({ section, code: 'unavailable' });
      } else {
        sections.photos = result;
      }
    }

    return { ok: true, sections, errors };
  }

  private async readAddresses(
    userId: string,
    pageNumber: number,
  ): Promise<InformationPage<AddressInformationItem>> {
    const page = await this.addresses.listForUser(userId, {
      page: pageNumber,
      pageSize: INFORMATION_PAGE_SIZE,
    });
    return {
      items: page.items.map((address) => ({
        addressId: address.id,
        isDefault: address.isDefault,
        displayName: address.isDefault ? '默认地址' : '收货地址',
      })),
      page: page.page,
      pageSize: INFORMATION_PAGE_SIZE,
      total: page.total,
    };
  }

  private async readOrders(
    userId: string,
    input: GetMyInformationInput,
  ): Promise<InformationPage<OrderInformationItem>> {
    const query = {
      page: input.page,
      pageSize: INFORMATION_PAGE_SIZE,
      ...(input.orderNo === undefined ? {} : { orderNo: input.orderNo }),
      ...(input.status === undefined
        ? {}
        : { status: input.status as OrderStatus }),
    };
    const page = await this.orders.listForUser(userId, query);
    const items = await Promise.all(
      page.items.map(async ({ id }) => {
        const order = await this.orders.getForUser(userId, id);
        return {
          orderNo: order.orderNo,
          status: order.status,
          closeReason: order.closeReason,
          itemsAmount: order.itemsAmount,
          payableAmount: order.payableAmount,
          itemCount: order.itemCount,
          createdAt: order.createdAt,
          paidAt: order.paidAt,
          shippedAt: order.shippedAt,
          completedAt: order.completedAt,
          items: order.items.map((item) => ({
            productName: item.productName,
            color: item.color,
            size: item.size,
            quantity: item.quantity,
          })),
        };
      }),
    );
    return {
      items,
      page: page.page,
      pageSize: INFORMATION_PAGE_SIZE,
      total: page.total,
    };
  }

  private async readPhotos(
    userId: string,
    pageNumber: number,
  ): Promise<InformationPage<SavedPhotoInformationItem>> {
    const page = await this.photos.listSavedMetadataForUser(userId, pageNumber);
    return {
      items: page.items.map((photo) => ({
        photoId: photo.photoId,
        kind: photo.kind,
        mimeType: photo.mimeType,
        byteSize: photo.byteSize,
        width: photo.width,
        height: photo.height,
        createdAt: photo.createdAt,
        availability: photo.availability,
      })),
      page: page.page,
      pageSize: INFORMATION_PAGE_SIZE,
      total: page.total,
    };
  }
}
