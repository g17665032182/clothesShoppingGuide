import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { LlmModule } from '../llm/llm.module.js';
import { ChatExtractionSourceModule } from '../chat-records/extraction-source/index.js';
import { UserMemoryDocumentController } from './controller/user-memory-document.controller.js';
import { UserMemorySettingsController } from './controller/user-memory-settings.controller.js';
import { UserMemoryTaskController } from './controller/user-memory-task.controller.js';
import { UserMemorySetting } from './entity/user-memory-setting.entity.js';
import { UserMemoryTask } from './entity/user-memory-task.entity.js';
import { UserMemoryDocumentState } from './entity/user-memory-document-state.entity.js';
import { UserMemoryDocumentTaskResult } from './entity/user-memory-document-task-result.entity.js';
import { UserMemoryDocumentCleanup } from './entity/user-memory-document-cleanup.entity.js';
import { UserMemoryDocumentService } from './service/user-memory-document.service.js';
import { UserMemoryDocumentStoreService } from './service/user-memory-document-store.service.js';
import { UserMemoryDocumentCleanupService } from './service/user-memory-document-cleanup.service.js';
import { UserMemoryReaderService } from './service/user-memory-reader.service.js';
import { UserMemorySettingsService } from './service/user-memory-settings.service.js';
import {
  USER_MEMORY_READER,
  USER_MEMORY_TASKS,
} from './port/user-memory.port.js';
import { UserMemoryExtractorService } from './service/user-memory-extractor.service.js';
import { UserMemorySchedulerService } from './service/user-memory-scheduler.service.js';
import { UserMemoryTaskService } from './service/user-memory-task.service.js';

@Module({
  imports: [
    LlmModule,
    ChatExtractionSourceModule,
    MikroOrmModule.forFeature([
      UserMemorySetting,
      UserMemoryTask,
      UserMemoryDocumentState,
      UserMemoryDocumentTaskResult,
      UserMemoryDocumentCleanup,
    ]),
  ],
  controllers: [
    UserMemoryDocumentController,
    UserMemorySettingsController,
    UserMemoryTaskController,
  ],
  providers: [
    UserMemorySettingsService,
    UserMemoryDocumentService,
    UserMemoryDocumentStoreService,
    UserMemoryDocumentCleanupService,
    UserMemoryReaderService,
    UserMemoryTaskService,
    UserMemoryExtractorService,
    UserMemorySchedulerService,
    { provide: USER_MEMORY_READER, useExisting: UserMemoryReaderService },
    { provide: USER_MEMORY_TASKS, useExisting: UserMemoryTaskService },
  ],
  exports: [USER_MEMORY_READER, USER_MEMORY_TASKS],
})
export class UserMemoryModule {}
