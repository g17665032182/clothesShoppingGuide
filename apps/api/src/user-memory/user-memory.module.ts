import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { LlmModule } from '../llm/llm.module.js';
import { UserMemoryController } from './controller/user-memory.controller.js';
import { UserMemory } from './entity/user-memory.entity.js';
import { UserMemorySetting } from './entity/user-memory-setting.entity.js';
import { UserMemoryTask } from './entity/user-memory-task.entity.js';
import { UserMemoryTaskResult } from './entity/user-memory-task-result.entity.js';
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
    ]),
  ],
  controllers: [UserMemoryController],
  providers: [
    UserMemoryService,
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
