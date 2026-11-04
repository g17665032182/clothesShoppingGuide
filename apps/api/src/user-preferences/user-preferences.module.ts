import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { ChatExtractionSourceModule } from '../chat-records/extraction-source/index.js';
import { LlmModule } from '../llm/llm.module.js';
import { UserPreferencesController } from './controller/user-preferences.controller.js';
import { UserPreference } from './entity/user-preference.entity.js';
import { UserPreferenceSetting } from './entity/user-preference-setting.entity.js';
import { UserPreferenceTask } from './entity/user-preference-task.entity.js';
import { UserPreferenceTaskResult } from './entity/user-preference-task-result.entity.js';
import {
  USER_PREFERENCES_READER,
  USER_PREFERENCES_TASKS,
  USER_PREFERENCES_LIFECYCLE,
} from './port/user-preferences.port.js';
import { UserPreferencesService } from './service/user-preferences.service.js';
import { UserPreferenceSettingsService } from './service/user-preference-settings.service.js';
import { UserPreferenceReaderService } from './service/user-preference-reader.service.js';
import { UserPreferenceLifecycleService } from './service/user-preference-lifecycle.service.js';
import { UserPreferenceTaskService } from './service/user-preference-task.service.js';
import { UserPreferenceExtractorService } from './service/user-preference-extractor.service.js';
import { UserPreferenceSchedulerService } from './service/user-preference-scheduler.service.js';

@Module({
  imports: [
    LlmModule,
    ChatExtractionSourceModule,
    MikroOrmModule.forFeature([
      UserPreference,
      UserPreferenceSetting,
      UserPreferenceTask,
      UserPreferenceTaskResult,
    ]),
  ],
  controllers: [UserPreferencesController],
  providers: [
    UserPreferencesService,
    UserPreferenceSettingsService,
    UserPreferenceReaderService,
    UserPreferenceLifecycleService,
    UserPreferenceTaskService,
    UserPreferenceExtractorService,
    UserPreferenceSchedulerService,
    {
      provide: USER_PREFERENCES_READER,
      useExisting: UserPreferenceReaderService,
    },
    { provide: USER_PREFERENCES_TASKS, useExisting: UserPreferenceTaskService },
    {
      provide: USER_PREFERENCES_LIFECYCLE,
      useExisting: UserPreferenceLifecycleService,
    },
  ],
  exports: [
    USER_PREFERENCES_READER,
    USER_PREFERENCES_TASKS,
    USER_PREFERENCES_LIFECYCLE,
  ],
})
export class UserPreferencesModule {}
