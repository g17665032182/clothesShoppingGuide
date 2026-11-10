import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { UserAddressesController } from './controller/user-addresses.controller.js';
import { UserAddress } from './entity/user-address.entity.js';
import { UserAddressesService } from './service/user-addresses.service.js';

@Module({
  imports: [MikroOrmModule.forFeature([UserAddress])],
  controllers: [UserAddressesController],
  providers: [UserAddressesService],
  exports: [UserAddressesService],
})
export class UserAddressesModule {}
