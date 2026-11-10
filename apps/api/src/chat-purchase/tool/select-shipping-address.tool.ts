import { HttpException } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import type { UserAddressesService } from '../../user-addresses/index.js';
import type { PurchaseDraftService } from '../service/purchase-draft.service.js';

const selectionSchema = z.strictObject({
  addressId: z.uuid(),
  draftId: z.uuid(),
  expectedVersion: z.number().int().safe().positive(),
});

/** 地址完整值只在服务端从本人地址簿复制到购买草稿，不返回给模型。 */
export function createSelectShippingAddressTool(
  drafts: PurchaseDraftService,
  addresses: UserAddressesService,
  userId: string,
  conversationId: string,
  used: (draftId?: string) => void,
) {
  return tool(
    async ({ addressId, draftId, expectedVersion }) => {
      used(draftId);
      try {
        const address = await addresses.getForUser(userId, addressId);
        const draft = await drafts.patch(userId, conversationId, draftId, {
          expectedVersion,
          recipient: {
            name: address.recipientName,
            phone: address.phone,
            address: address.address,
          },
        });
        used(draft.id);
        return JSON.stringify({
          ok: true,
          result: {
            draftId: draft.id,
            version: draft.version,
            filled: {
              name: Boolean(draft.recipient.name),
              phone: Boolean(draft.recipient.phone),
              address: Boolean(draft.recipient.address),
            },
          },
        });
      } catch (error) {
        const status = error instanceof HttpException ? error.getStatus() : 503;
        return JSON.stringify({
          ok: false,
          code:
            status === 409
              ? 'version_conflict'
              : status === 404
                ? 'not_found'
                : 'unavailable',
        });
      }
    },
    {
      name: 'select_my_shipping_address',
      description:
        '用户明确选择本人地址后，将服务端地址写入当前购买草稿。不得询问用户地址内容。',
      schema: selectionSchema,
    },
  );
}
