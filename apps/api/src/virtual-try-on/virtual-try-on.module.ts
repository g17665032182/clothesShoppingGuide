import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { ProductCatalogModule } from '../product-catalog/index.js';
import { LocalPrivateObjectStorageService } from '../common/storage/local-private-object-storage.service.js';
import { TryOnLocalAssetController } from './controller/try-on-local-asset.controller.js';
import { TryOnPhotoController } from './controller/try-on-photo.controller.js';
import { TryOnTaskController } from './controller/try-on-task.controller.js';
import { TryOnObjectCleanup } from './entity/try-on-object-cleanup.entity.js';
import { TryOnPhoto } from './entity/try-on-photo.entity.js';
import { TryOnQuota } from './entity/try-on-quota.entity.js';
import { TryOnResult } from './entity/try-on-result.entity.js';
import { TryOnTask } from './entity/try-on-task.entity.js';
import { TryOnImageProcessingService } from './service/image-processing.service.js';
import { OpenaiCompatibleTryOnProviderService } from './service/openai-compatible-try-on-provider.service.js';
import { LocalTryOnObjectStoreService } from './service/local-try-on-object-store.service.js';
import { QiniuTryOnObjectStoreService } from './service/qiniu-try-on-object-store.service.js';
import { TryOnNotificationService } from './service/try-on-notification.service.js';
import { TryOnPhotoService } from './service/try-on-photo.service.js';
import { TryOnQuotaService } from './service/try-on-quota.service.js';
import { TryOnTaskService } from './service/try-on-task.service.js';
import { TryOnTaskReaderService } from './service/try-on-task-reader.service.js';
import { TryOnWorkerService } from './service/try-on-worker.service.js';
import { TryOnObjectCleanupService } from './service/try-on-object-cleanup.service.js';
import { TRY_ON_IMAGE_PROVIDER } from './port/try-on-image-provider.port.js';
import { TRY_ON_OBJECT_STORE } from './port/try-on-object-store.port.js';
import { CHAT_TRY_ON_PORT } from './port/chat-try-on.port.js';
import { ChatTryOnService } from './service/chat-try-on.service.js';

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
  controllers: [
    TryOnPhotoController,
    TryOnTaskController,
    TryOnLocalAssetController,
  ],
  providers: [
    TryOnPhotoService,
    TryOnTaskService,
    TryOnTaskReaderService,
    ChatTryOnService,
    TryOnQuotaService,
    TryOnNotificationService,
    TryOnWorkerService,
    TryOnObjectCleanupService,
    TryOnImageProcessingService,
    OpenaiCompatibleTryOnProviderService,
    LocalPrivateObjectStorageService,
    LocalTryOnObjectStoreService,
    QiniuTryOnObjectStoreService,
    {
      provide: TRY_ON_IMAGE_PROVIDER,
      useExisting: OpenaiCompatibleTryOnProviderService,
    },
    {
      provide: TRY_ON_OBJECT_STORE,
      useFactory: (
        config: ConfigService,
        qiniuStore: QiniuTryOnObjectStoreService,
        localStore: LocalTryOnObjectStoreService,
      ) => {
        const driver = config.get<string>('TRY_ON_STORAGE_DRIVER') ?? 'qiniu';
        if (driver === 'local') {
          if (config.get<string>('NODE_ENV') !== 'development')
            throw new Error('本地试穿存储只允许在 development 环境启用');
          return localStore;
        }
        if (driver !== 'qiniu')
          throw new Error('TRY_ON_STORAGE_DRIVER 配置无效');
        return qiniuStore;
      },
      inject: [
        ConfigService,
        QiniuTryOnObjectStoreService,
        LocalTryOnObjectStoreService,
      ],
    },
    {
      provide: CHAT_TRY_ON_PORT,
      useExisting: ChatTryOnService,
    },
  ],
  exports: [
    TryOnPhotoService,
    TryOnTaskService,
    TryOnTaskReaderService,
    TRY_ON_IMAGE_PROVIDER,
    TRY_ON_OBJECT_STORE,
    CHAT_TRY_ON_PORT,
  ],
})
export class VirtualTryOnModule {}
