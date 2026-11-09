import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { ProductCatalogModule } from '../product-catalog/index.js';
import { TryOnPhotoController } from './controller/try-on-photo.controller.js';
import { TryOnTaskController } from './controller/try-on-task.controller.js';
import { TryOnObjectCleanup } from './entity/try-on-object-cleanup.entity.js';
import { TryOnPhoto } from './entity/try-on-photo.entity.js';
import { TryOnQuota } from './entity/try-on-quota.entity.js';
import { TryOnResult } from './entity/try-on-result.entity.js';
import { TryOnTask } from './entity/try-on-task.entity.js';
import { TryOnImageProcessingService } from './service/image-processing.service.js';
import { OpenaiCompatibleTryOnProviderService } from './service/openai-compatible-try-on-provider.service.js';
import { QiniuTryOnObjectStoreService } from './service/qiniu-try-on-object-store.service.js';
import { TryOnNotificationService } from './service/try-on-notification.service.js';
import { TryOnPhotoService } from './service/try-on-photo.service.js';
import { TryOnQuotaService } from './service/try-on-quota.service.js';
import { TryOnTaskService } from './service/try-on-task.service.js';
import { TryOnWorkerService } from './service/try-on-worker.service.js';
import { TryOnObjectCleanupService } from './service/try-on-object-cleanup.service.js';
import { TRY_ON_IMAGE_PROVIDER } from './port/try-on-image-provider.port.js';
import { TRY_ON_OBJECT_STORE } from './port/try-on-object-store.port.js';

@Module({
  imports: [
    ProductCatalogModule,
    MikroOrmModule.forFeature([
      TryOnPhoto,
      TryOnTask,
      TryOnResult,
      TryOnQuota,
      TryOnObjectCleanup,
    ]),
  ],
  controllers: [TryOnPhotoController, TryOnTaskController],
  providers: [
    TryOnPhotoService,
    TryOnTaskService,
    TryOnQuotaService,
    TryOnNotificationService,
    TryOnWorkerService,
    TryOnObjectCleanupService,
    TryOnImageProcessingService,
    OpenaiCompatibleTryOnProviderService,
    QiniuTryOnObjectStoreService,
    {
      provide: TRY_ON_IMAGE_PROVIDER,
      useExisting: OpenaiCompatibleTryOnProviderService,
    },
    {
      provide: TRY_ON_OBJECT_STORE,
      useExisting: QiniuTryOnObjectStoreService,
    },
  ],
  exports: [
    TryOnPhotoService,
    TryOnTaskService,
    TRY_ON_IMAGE_PROVIDER,
    TRY_ON_OBJECT_STORE,
  ],
})
export class VirtualTryOnModule {}
