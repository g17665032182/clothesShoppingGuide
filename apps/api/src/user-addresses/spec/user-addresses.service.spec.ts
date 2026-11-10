import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';

import type { CreateUserAddressInput } from '../dto/user-address.schema.js';
import { UserAddress } from '../entity/user-address.entity.js';
import { UserAddressesService } from '../service/user-addresses.service.js';

function makeAddress(input: Partial<UserAddress> = {}): UserAddress {
  return Object.assign(new UserAddress(), {
    id: randomUUID(),
    userId: randomUUID(),
    recipientName: '张三',
    phone: '13800138000',
    address: '虚构测试地址',
    label: null,
    isDefault: false,
    createRequestKey: randomUUID(),
    createdAt: new Date('2026-11-10T00:00:00.000Z'),
    updatedAt: new Date('2026-11-10T00:00:00.000Z'),
    ...input,
  });
}

function createRequest(
  address: UserAddress,
  overrides: Partial<CreateUserAddressInput> = {},
): CreateUserAddressInput {
  return {
    requestKey: address.createRequestKey,
    recipientName: address.recipientName,
    phone: address.phone,
    address: address.address,
    label: address.label ?? undefined,
    isDefault: address.isDefault,
    ...overrides,
  };
}

test('地址创建同用户同键同内容重放返回原地址', async () => {
  const previous = makeAddress();
  const repository = {
    getEntityManager: () => ({
      transactional: async (callback: (em: unknown) => unknown) =>
        callback({
          getConnection: () => ({ execute: async () => undefined }),
          getTransactionContext: () => ({}),
          getRepository: () => ({
            findOne: async () => previous,
          }),
        }),
    }),
  };
  const service = new UserAddressesService(repository as never);
  const result = await service.create(previous.userId, createRequest(previous));
  assert.equal(result.id, previous.id);
  assert.equal('userId' in result, false);
  assert.equal('createRequestKey' in result, false);
});

test('地址创建同键异内容返回 409', async () => {
  const previous = makeAddress();
  const repository = {
    getEntityManager: () => ({
      transactional: async (callback: (em: unknown) => unknown) =>
        callback({
          getConnection: () => ({ execute: async () => undefined }),
          getTransactionContext: () => ({}),
          getRepository: () => ({
            findOne: async () => previous,
          }),
        }),
    }),
  };
  const service = new UserAddressesService(repository as never);
  await assert.rejects(
    service.create(
      previous.userId,
      createRequest(previous, { address: '另一条地址' }),
    ),
    ConflictException,
  );
});

test('本人地址读取按 userId 和 addressId 联合查询', async () => {
  const ownerId = randomUUID();
  let query: unknown;
  const repository = {
    findOne: async (where: unknown) => {
      query = where;
      return null;
    },
  };
  const service = new UserAddressesService(repository as never);
  await assert.rejects(
    service.getForUser(ownerId, randomUUID()),
    NotFoundException,
  );
  assert.deepEqual(query, {
    id: query && (query as { id: string }).id,
    userId: ownerId,
  });
});
