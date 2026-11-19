import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { OrdersModule } from '../orders/index.js';
import { AdminReturnRefundController } from './controller/admin-return-refund.controller.js';
import { ReturnRefundController } from './controller/return-refund.controller.js';
import { ReturnRefundEvidenceController } from './controller/return-refund-evidence.controller.js';
import { ReturnRefundApplication } from './entity/return-refund-application.entity.js';
import { ReturnRefundEvent } from './entity/return-refund-event.entity.js';
import { ReturnRefundItem } from './entity/return-refund-item.entity.js';
import { ReturnRefundEvidence } from './entity/return-refund-evidence.entity.js';
import { QiniuReturnRefundEvidenceStoreService } from './storage/qiniu-return-refund-evidence-store.service.js';
import { RETURN_REFUND_EVIDENCE_STORE } from './port/return-refund-evidence-store.port.js';
import { RETURN_REFUND_ELIGIBILITY_POLICY } from './port/return-refund-eligibility.port.js';
import { ReturnRefundEvidenceService } from './service/return-refund-evidence.service.js';
import { ReturnRefundEligibilityService } from './service/return-refund-eligibility.service.js';
import { ReturnRefundQueryService } from './service/return-refund-query.service.js';
import { ReturnRefundService } from './service/return-refund.service.js';

@Module({
  imports: [
    OrdersModule,
    MikroOrmModule.forFeature([
      ReturnRefundApplication,
      ReturnRefundItem,
      ReturnRefundEvent,
      ReturnRefundEvidence,
    ]),
  ],
  controllers: [
    ReturnRefundController,
    AdminReturnRefundController,
    ReturnRefundEvidenceController,
  ],
  providers: [
    ReturnRefundService,
    ReturnRefundQueryService,
    ReturnRefundEvidenceService,
    ReturnRefundEligibilityService,
    QiniuReturnRefundEvidenceStoreService,
    {
      provide: RETURN_REFUND_ELIGIBILITY_POLICY,
      useExisting: ReturnRefundEligibilityService,
    },
    {
      provide: RETURN_REFUND_EVIDENCE_STORE,
      useExisting: QiniuReturnRefundEvidenceStoreService,
    },
  ],
  exports: [ReturnRefundService, ReturnRefundQueryService],
})
export class ReturnRefundModule {}
