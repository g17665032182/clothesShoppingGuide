import { Module } from '@nestjs/common';

import { OrdersModule } from '../orders/index.js';
import { UserAddressesModule } from '../user-addresses/index.js';
import { VirtualTryOnModule } from '../virtual-try-on/index.js';
import { ChatUserInformationService } from './service/chat-user-information.service.js';

@Module({
  imports: [UserAddressesModule, OrdersModule, VirtualTryOnModule],
  providers: [ChatUserInformationService],
  exports: [ChatUserInformationService],
})
export class ChatUserInformationModule {}
