import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { UserAddress } from '../entity/user-address.entity.js';

export class UserAddressResponseDto {
  @ApiProperty({ format: 'uuid' })
  public id!: string;

  @ApiProperty()
  public recipientName!: string;

  @ApiProperty()
  public phone!: string;

  @ApiProperty()
  public address!: string;

  @ApiPropertyOptional({ nullable: true })
  public label!: string | null;

  @ApiProperty()
  public isDefault!: boolean;

  @ApiProperty({ format: 'date-time' })
  public createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  public updatedAt!: string;
}

export class UserAddressPageResponseDto {
  @ApiProperty({ type: [UserAddressResponseDto] })
  public items!: UserAddressResponseDto[];

  @ApiProperty()
  public total!: number;

  @ApiProperty()
  public page!: number;

  @ApiProperty()
  public pageSize!: number;
}

export function toUserAddressResponse(
  address: UserAddress,
): UserAddressResponseDto {
  return {
    id: address.id,
    recipientName: address.recipientName,
    phone: address.phone,
    address: address.address,
    label: address.label,
    isDefault: address.isDefault,
    createdAt: address.createdAt.toISOString(),
    updatedAt: address.updatedAt.toISOString(),
  };
}
