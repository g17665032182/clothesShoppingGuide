import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type EntityManager,
  LockMode,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import type {
  CreateUserAddressInput,
  ListUserAddressesQuery,
  UpdateUserAddressInput,
} from '../dto/user-address.schema.js';
import {
  toUserAddressResponse,
  type UserAddressPageResponseDto,
  type UserAddressResponseDto,
} from '../dto/user-address-response.dto.js';
import { UserAddress } from '../entity/user-address.entity.js';

@Injectable()
export class UserAddressesService {
  public constructor(
    @InjectRepository(UserAddress)
    private readonly addresses: EntityRepository<UserAddress>,
  ) {}

  public async listForUser(
    userId: string,
    query: ListUserAddressesQuery,
  ): Promise<UserAddressPageResponseDto> {
    const where = { userId };
    const [items, total] = await Promise.all([
      this.addresses.find(where, {
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      }),
      this.addresses.count(where),
    ]);
    return {
      items: items.map(toUserAddressResponse),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  public async getForUser(
    userId: string,
    addressId: string,
  ): Promise<UserAddressResponseDto> {
    const address = await this.addresses.findOne({ id: addressId, userId });
    if (!address) throw new NotFoundException('收货地址不存在');
    return toUserAddressResponse(address);
  }

  public async create(
    userId: string,
    input: CreateUserAddressInput,
  ): Promise<UserAddressResponseDto> {
    const em = this.addresses.getEntityManager();
    try {
      return await em.transactional(async (transactionalEm) => {
        // 同用户同请求键串行执行，避免并发重试在唯一约束竞争窗口中误报冲突。
        await transactionalEm
          .getConnection()
          .execute(
            'select pg_advisory_xact_lock(hashtextextended(?, 0))',
            [`user-address-create:${userId}:${input.requestKey}`],
            'run',
            transactionalEm.getTransactionContext(),
          );
        const repository = transactionalEm.getRepository(UserAddress);
        const previous = await repository.findOne({
          userId,
          createRequestKey: input.requestKey,
        });
        if (previous) {
          this.assertSameCreateContent(previous, input);
          return toUserAddressResponse(previous);
        }

        if (input.isDefault) await this.lockUser(transactionalEm, userId);
        if (input.isDefault) {
          await repository.nativeUpdate(
            { userId, isDefault: true },
            {
              isDefault: false,
            },
          );
        }
        const address = repository.create({
          userId,
          createRequestKey: input.requestKey,
          recipientName: input.recipientName,
          phone: input.phone,
          address: input.address,
          label: input.label ?? null,
          isDefault: input.isDefault,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        transactionalEm.persist(address);
        await transactionalEm.flush();
        return toUserAddressResponse(address);
      });
    } catch (error) {
      if (!(error instanceof UniqueConstraintViolationException)) throw error;
      const previous = await this.addresses.findOne({
        userId,
        createRequestKey: input.requestKey,
      });
      if (!previous) throw error;
      this.assertSameCreateContent(previous, input);
      return toUserAddressResponse(previous);
    }
  }

  public async update(
    userId: string,
    addressId: string,
    input: UpdateUserAddressInput,
  ): Promise<UserAddressResponseDto> {
    return this.addresses.getEntityManager().transactional(async (em) => {
      if (input.isDefault === true) await this.lockUser(em, userId);
      const address = await em.findOne(
        UserAddress,
        { id: addressId, userId },
        input.isDefault === true
          ? { lockMode: LockMode.PESSIMISTIC_WRITE }
          : {},
      );
      if (!address) throw new NotFoundException('收货地址不存在');
      if (input.isDefault === true) {
        await em.nativeUpdate(
          UserAddress,
          { userId, isDefault: true, id: { $ne: address.id } },
          { isDefault: false },
        );
      }
      if (input.recipientName !== undefined)
        address.recipientName = input.recipientName;
      if (input.phone !== undefined) address.phone = input.phone;
      if (input.address !== undefined) address.address = input.address;
      if (input.label !== undefined) address.label = input.label;
      if (input.isDefault !== undefined) address.isDefault = input.isDefault;
      address.updatedAt = new Date();
      await em.flush();
      return toUserAddressResponse(address);
    });
  }

  public async delete(userId: string, addressId: string): Promise<void> {
    await this.addresses.getEntityManager().transactional(async (em) => {
      await this.lockUser(em, userId);
      const address = await em.findOne(UserAddress, {
        id: addressId,
        userId,
      });
      if (!address) throw new NotFoundException('收货地址不存在');
      em.remove(address);
      await em.flush();
    });
  }

  private async lockUser(em: EntityManager, userId: string): Promise<void> {
    await em
      .getConnection()
      .execute(
        'select id from users where id = ? for update',
        [userId],
        'run',
        em.getTransactionContext(),
      );
  }

  private assertSameCreateContent(
    previous: UserAddress,
    input: CreateUserAddressInput,
  ): void {
    const same =
      previous.recipientName === input.recipientName &&
      previous.phone === input.phone &&
      previous.address === input.address &&
      previous.label === (input.label ?? null) &&
      previous.isDefault === input.isDefault;
    if (!same) throw new ConflictException('幂等键已用于不同的地址内容');
  }
}
