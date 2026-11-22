import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import { ProductCatalogModule } from '../product-catalog/index.js';
import { FashionRecommendationController } from './controller/fashion-recommendation.controller.js';
import { RecommendationFeedback } from './entity/recommendation-feedback.entity.js';
import { RecommendationGroup } from './entity/recommendation-group.entity.js';
import { RecommendationProfileTask } from './entity/recommendation-profile-task.entity.js';
import { RecommendationProfile } from './entity/recommendation-profile.entity.js';
import { RecommendationSetting } from './entity/recommendation-setting.entity.js';
import { FASHION_RECOMMENDATION_PORT } from './port/fashion-recommendation.port.js';
import { RECOMMENDATION_PRODUCT_SOURCE } from './port/recommendation-product-source.port.js';
import { FashionRecommendationService } from './service/fashion-recommendation.service.js';
import { OutfitComposerService } from './service/outfit-composer.service.js';
import { RecommendationFeedbackService } from './service/recommendation-feedback.service.js';
import { RecommendationGroupService } from './service/recommendation-group.service.js';
import { RecommendationOrchestratorService } from './service/recommendation-orchestrator.service.js';
import { RecommendationProfileService } from './service/recommendation-profile.service.js';
import { RecommendationSettingsService } from './service/recommendation-settings.service.js';
import { RecommendationSourceRegistryService } from './service/recommendation-source-registry.service.js';
import { LocalProductCatalogSource } from './source/local-product-catalog.source.js';
import { RecommendationProfileSchedulerService } from './task/recommendation-profile-scheduler.service.js';
import { RecommendationProfileTaskService } from './task/recommendation-profile-task.service.js';

@Module({
  imports: [
    ProductCatalogModule,
    MikroOrmModule.forFeature([
      RecommendationGroup,
      RecommendationFeedback,
      RecommendationProfile,
      RecommendationSetting,
      RecommendationProfileTask,
    ]),
  ],
  controllers: [FashionRecommendationController],
  providers: [
    RecommendationSourceRegistryService,
    OutfitComposerService,
    RecommendationOrchestratorService,
    LocalProductCatalogSource,
    RecommendationGroupService,
    RecommendationFeedbackService,
    RecommendationProfileService,
    RecommendationSettingsService,
    RecommendationProfileTaskService,
    RecommendationProfileSchedulerService,
    FashionRecommendationService,
    {
      provide: RECOMMENDATION_PRODUCT_SOURCE,
      useExisting: LocalProductCatalogSource,
    },
    {
      provide: FASHION_RECOMMENDATION_PORT,
      useExisting: FashionRecommendationService,
    },
  ],
  exports: [FASHION_RECOMMENDATION_PORT],
})
export class FashionPersonalizationModule {}
