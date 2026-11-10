import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorator/current-user.decorator.js';
import {
  addressIdSchema,
  createUserAddressSchema,
  listUserAddressesQuerySchema,
  updateUserAddressSchema,
  type CreateUserAddressInput,
  type ListUserAddressesQuery,
  type UpdateUserAddressInput,
} from '../dto/user-address.schema.js';
import {
  UserAddressPageResponseDto,
  UserAddressResponseDto,
} from '../dto/user-address-response.dto.js';
import { UserAddressesService } from '../service/user-addresses.service.js';

@Controller('users/me/addresses')
@ApiBearerAuth('bearer')
@ApiTags('用户收货地址')
@ApiUnauthorizedResponse({ description: '未登录或账号禁用' })
export class UserAddressesController {
  public constructor(
    @Inject(UserAddressesService)
    private readonly addresses: UserAddressesService,
  ) {}

  @Get()
  @ApiOkResponse({ type: UserAddressPageResponseDto })
  public list(
    @CurrentUser() user: { id: string },
    @Query({ schema: listUserAddressesQuerySchema })
    query: ListUserAddressesQuery,
  ) {
    return this.addresses.listForUser(user.id, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: UserAddressResponseDto })
  @ApiNotFoundResponse({ description: '地址不存在或不属于当前用户' })
  public get(
    @CurrentUser() user: { id: string },
    @Param({ schema: addressIdSchema }) params: { id: string },
  ) {
    return this.addresses.getForUser(user.id, params.id);
  }

  @Post()
  @ApiBody({
    schema: {
      type: 'object',
      required: ['requestKey', 'recipientName', 'phone', 'address'],
      additionalProperties: false,
      properties: {
        requestKey: { type: 'string', format: 'uuid' },
        recipientName: { type: 'string', minLength: 1, maxLength: 100 },
        phone: { type: 'string', pattern: '^\\+?\\d{6,20}$' },
        address: { type: 'string', minLength: 1, maxLength: 500 },
        label: { type: 'string', nullable: true, maxLength: 40 },
        isDefault: { type: 'boolean', default: false },
      },
    },
  })
  @ApiCreatedResponse({
    type: UserAddressResponseDto,
    description: '新建地址或返回同一幂等请求的原地址',
  })
  @ApiBadRequestResponse({ description: '地址字段或 requestKey 不合法' })
  @ApiConflictResponse({ description: 'requestKey 已用于不同地址内容' })
  public create(
    @CurrentUser() user: { id: string },
    @Body({ schema: createUserAddressSchema }) input: CreateUserAddressInput,
  ) {
    return this.addresses.create(user.id, input);
  }

  @Patch(':id')
  @ApiOkResponse({ type: UserAddressResponseDto })
  @ApiBadRequestResponse({ description: '地址字段无效或没有可更新字段' })
  @ApiNotFoundResponse({ description: '地址不存在或不属于当前用户' })
  public update(
    @CurrentUser() user: { id: string },
    @Param({ schema: addressIdSchema }) params: { id: string },
    @Body({ schema: updateUserAddressSchema }) input: UpdateUserAddressInput,
  ) {
    return this.addresses.update(user.id, params.id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: '地址已删除' })
  @ApiNotFoundResponse({ description: '地址不存在或不属于当前用户' })
  public delete(
    @CurrentUser() user: { id: string },
    @Param({ schema: addressIdSchema }) params: { id: string },
  ): Promise<void> {
    return this.addresses.delete(user.id, params.id);
  }
}
