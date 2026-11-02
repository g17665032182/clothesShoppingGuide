import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { LlmModule } from '../llm/llm.module.js';
import { UserMemoryController } from './controller/user-memory.controller.js';
import { UserMemory } from './entity/user-memory.entity.js';
import { UserMemorySetting } from './entity/user-memory-setting.entity.js';
import { UserMemoryTask } from './entity/user-memory-task.entity.js';
import { UserMemoryTaskResult } from './entity/user-memory-task-result.entity.js';
import { UserMemoryDocumentState } from './entity/user-memory-document-state.entity.js';
import { UserMemoryDocumentTaskResult } from './entity/user-memory-document-task-result.entity.js';
import { UserMemoryDocumentCleanup } from './entity/user-memory-document-cleanup.entity.js';
import { UserMemoryDocumentService } from './service/user-memory-document.service.js';
import { UserMemoryDocumentStoreService } from './service/user-memory-document-store.service.js';
import { UserMemoryDocumentCleanupService } from './service/user-memory-document-cleanup.service.js';
import { UserMemoryLifecycleService } from './service/user-memory-lifecycle.service.js';
import { UserMemoryReaderService } from './service/user-memory-reader.service.js';
import { UserMemoryService } from './service/user-memory.service.js';
import { UserMemoryExtractorService } from './service/user-memory-extractor.service.js';
import { UserMemorySchedulerService } from './service/user-memory-scheduler.service.js';
import { UserMemoryTaskService } from './service/user-memory-task.service.js';

@Module({
  imports: [
    LlmModule,
    MikroOrmModule.forFeature([
      UserMemory,
      UserMemorySetting,
      UserMemoryTask,
      UserMemoryTaskResult,
      UserMemoryDocumentState,
      UserMemoryDocumentTaskResult,
      UserMemoryDocumentCleanup,
    ]),
  ],
  controllers: [UserMemoryController],
  providers: [
    UserMemoryService,
    UserMemoryDocumentService,
    UserMemoryDocumentStoreService,
    UserMemoryDocumentCleanupService,
    UserMemoryReaderService,
    UserMemoryLifecycleService,
    UserMemoryTaskService,
    UserMemoryExtractorService,
    UserMemorySchedulerService,
  ],
  exports: [
    UserMemoryReaderService,
    UserMemoryLifecycleService,
    UserMemoryTaskService,
  ],
})
export class UserMemoryModule {}
