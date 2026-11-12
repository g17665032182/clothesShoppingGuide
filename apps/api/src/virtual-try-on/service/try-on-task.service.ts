import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LockMode, type EntityManager } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import {
  TryOnPhoto,
  TryOnPhotoKind,
  TryOnPhotoStatus,
} from '../entity/try-on-photo.entity.js';
import { TryOnObjectCleanup } from '../entity/try-on-object-cleanup.entity.js';
import { TryOnResult } from '../entity/try-on-result.entity.js';
import { TryOnTask, TryOnTaskStatus } from '../entity/try-on-task.entity.js';
import {
  PRODUCT_CATALOG_TRY_ON_PORT,
  type ProductCatalogTryOnPort,
} from '../../product-catalog/index.js';
import {
  TRY_ON_OBJECT_STORE,
  type TryOnObjectStore,
} from '../port/try-on-object-store.port.js';
import type {
  CreateTryOnTaskInput,
  TryOnTaskQuery,
} from '../dto/try-on-task.dto.js';
import { TryOnPhotoService } from './try-on-photo.service.js';
import { TryOnQuotaService } from './try-on-quota.service.js';
import { TryOnImageProcessingService } from './image-processing.service.js';

const ALLOWED_CATEGORIES = new Set(['tops', 'bottoms', 'dresses', 'outerwear']);
const CHAT_RESULT_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

@Injectable()
export class TryOnTaskService {
  public constructor(
    @InjectRepository(TryOnTask)
    private readonly tasks: EntityRepository<TryOnTask>,
    @InjectRepository(TryOnResult)
    private readonly results: EntityRepository<TryOnResult>,
    @Inject(PRODUCT_CATALOG_TRY_ON_PORT)
    private readonly catalog: ProductCatalogTryOnPort,
    @Inject(TRY_ON_OBJECT_STORE)
    private readonly objectStore: TryOnObjectStore,
    private readonly photos: TryOnPhotoService,
    private readonly quota: TryOnQuotaService,
    private readonly config: ConfigService,
    private readonly imageProcessing?: TryOnImageProcessingService,
  ) {}

  public async create(userId: string, input: CreateTryOnTaskInput) {
    this.assertEnabled();
    const em = this.tasks.getEntityManager().fork();
    return em.transactional(async (transaction) => {
      // 同一账号跨进程串行创建，避免并发请求同时通过活动任务检查。
      await transaction
        .getConnection()
        .execute(
          'select pg_advisory_xact_lock(hashtextextended(?, 0))',
          [`try-on-active-task:${userId}`],
          'run',
          transaction.getTransactionContext(),
        );
      const active = await transaction.findOne(TryOnTask, {
        userId,
        status: { $in: [TryOnTaskStatus.QUEUED, TryOnTaskStatus.PROCESSING] },
      });
      if (active) {
        throw new ConflictException({
          code: 'ACTIVE_TASK_EXISTS',
          message: '已有试穿任务正在处理',
        });
      }
      await this.quota.assertAvailable(transaction, userId);
      const consentVersion =
        this.config.get<string>('TRY_ON_CONSENT_VERSION')?.trim() || 'v1';
      if (input.consentVersion !== consentVersion) {
        throw new ConflictException({
          code: 'CONSENT_REQUIRED',
          message: '请先同意最新的图像处理说明',
        });
      }

      const product = await this.catalog.getTryOnProduct(
        input.productExternalId,
      );
      if (!product) throw new NotFoundException('商品不存在');
      if (
        !product.tryOnEnabled ||
        !product.tryOnEligible ||
        !ALLOWED_CATEGORIES.has(product.category)
      ) {
        throw new ConflictException({
          code: 'PRODUCT_NOT_TRYON_SUPPORTED',
          message: '当前商品不支持试穿',
        });
      }
      const color = product.colors.find(
        (entry) =>
          entry.color.trim().toLowerCase() === input.color.toLowerCase(),
      );
      if (!color) {
        throw new ConflictException({
          code: 'COLOR_UNAVAILABLE',
          message: '当前颜色不可用',
        });
      }
      const garmentImageUrl = color.imageUrl;
      // 缺图颜色只使用管理员上传的商品级后备，不借用其他颜色的 SKU 图。
      const garmentImageObjectKey = garmentImageUrl
        ? null
        : product.tryOnImageObjectKey;
      if (!garmentImageUrl && !garmentImageObjectKey) {
        throw new ConflictException({
          code: 'PRODUCT_NOT_TRYON_SUPPORTED',
          message: '当前商品颜色没有可用的试穿图片',
        });
      }
      // 商品设置与图片检查先于照片绑定，旧卡片不能绕过当前目录的准入条件。
      const photo = await transaction.findOne(
        TryOnPhoto,
        {
          id: input.photoId,
          userId,
          status: TryOnPhotoStatus.ACTIVE,
        },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (
        !photo ||
        (photo.expiresAt && photo.expiresAt <= new Date()) ||
        (photo.kind === TryOnPhotoKind.TEMPORARY && photo.taskId)
      ) {
        throw new ConflictException({
          code: 'PHOTO_UNAVAILABLE',
          message: '照片不可用于当前任务',
        });
      }

      const task = transaction.create(TryOnTask, {
        userId,
        status: TryOnTaskStatus.QUEUED,
        productExternalId: product.productExternalId,
        productName: product.productName,
        productCategory: product.category,
        color: color.color,
        garmentImageUrl,
        garmentImageObjectKey,
        sourcePhotoId: photo.id,
        consentVersion,
        consentedAt: new Date(),
        attempts: 0,
        availableAt: new Date(),
        lockedAt: null,
        failureCode: null,
        providerModel: this.config.get<string>('TRY_ON_MODEL')?.trim() || null,
        providerRequestId: null,
        notificationReadAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        deletedAt: null,
      });
      await this.photos.bindToTask(transaction, userId, photo.id, task.id);
      await transaction.flush();
      return this.toResponse(task, null);
    });
  }

  public async getWorkerPhoto(photoId: string): Promise<TryOnPhoto | null> {
    return this.tasks.getEntityManager().fork().findOne(TryOnPhoto, {
      id: photoId,
      status: TryOnPhotoStatus.ACTIVE,
    });
  }

  public async claimBatch(limit = 2): Promise<TryOnTask[]> {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 10);
    const em = this.tasks.getEntityManager().fork();
    const ids = await em.transactional(async (transaction) => {
      const rows = await transaction
        .getConnection()
        .execute<Array<{ id: string }>>(
          `with selected as (
          select id
          from try_on_tasks
          where status = 'queued' and available_at <= now()
          order by available_at asc, created_at asc
          for update skip locked
          limit ?
        )
        update try_on_tasks as task
        set status = 'processing',
            attempts = task.attempts + 1,
            locked_at = now(),
            updated_at = now()
        from selected
        where task.id = selected.id
        returning task.id`,
          [boundedLimit],
          'all',
          transaction.getTransactionContext(),
        );
      return rows.map((row) => row.id);
    });
    if (ids.length === 0) return [];
    return em.find(TryOnTask, { id: { $in: ids } });
  }

  public async recoverExpiredProcessing(): Promise<void> {
    const em = this.tasks.getEntityManager().fork();
    const failed = await em.transactional(async (transaction) => {
      const rows = await transaction.getConnection().execute<
        Array<{
          id: string;
          attempts: number;
          source_photo_id: string | null;
        }>
      >(
        `with expired as (
          select id
          from try_on_tasks
          where status = 'processing'
            and locked_at < now() - interval '180 seconds'
          for update skip locked
        )
        update try_on_tasks as task
        set status = case when task.attempts >= 2 then 'failed' else 'queued' end,
            failure_code = case when task.attempts >= 2 then 'PROCESSING_TIMEOUT' else task.failure_code end,
            completed_at = case when task.attempts >= 2 then now() else task.completed_at end,
            available_at = now(),
            locked_at = null,
            updated_at = now()
        from expired
        where task.id = expired.id
        returning task.id, task.attempts, task.source_photo_id`,
        [],
        'all',
        transaction.getTransactionContext(),
      );
      return rows.filter((row) => row.attempts >= 2);
    });
    for (const task of failed) {
      if (task.source_photo_id) {
        await this.cleanupTaskSourcePhoto(task.id, task.source_photo_id);
      }
    }
  }

  public async scheduleRetry(
    task: TryOnTask,
    failureCode: string,
    delayMs = 1_000,
  ): Promise<void> {
    if (task.attempts >= 2) {
      await this.markFailed(task, failureCode);
      return;
    }
    await this.tasks.nativeUpdate(
      { id: task.id, status: TryOnTaskStatus.PROCESSING },
      {
        status: TryOnTaskStatus.QUEUED,
        failureCode: failureCode.slice(0, 80),
        lockedAt: null,
        availableAt: new Date(Date.now() + Math.max(delayMs, 0)),
        updatedAt: new Date(),
      },
    );
  }

  public async markSucceeded(
    task: TryOnTask,
    resultInput: {
      resultId?: string;
      objectKey: string;
      mimeType: string;
      byteSize: number;
      width: number;
      height: number;
      providerRequestId: string | null;
    },
  ): Promise<void> {
    const em = this.tasks.getEntityManager().fork();
    try {
      await em.transactional(async (transaction) => {
        const current = await transaction.findOne(
          TryOnTask,
          { id: task.id, status: TryOnTaskStatus.PROCESSING },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        if (!current) throw new ConflictException('试穿任务状态已变化');
        const {
          resultId,
          providerRequestId: _providerRequestId,
          ...resultRecord
        } = resultInput;
        transaction.create(TryOnResult, {
          ...(resultId ? { id: resultId } : {}),
          taskId: current.id,
          userId: current.userId,
          ...resultRecord,
          createdAt: new Date(),
          deletedAt: null,
        });
        current.status = TryOnTaskStatus.SUCCEEDED;
        current.providerRequestId = resultInput.providerRequestId;
        current.failureCode = null;
        current.lockedAt = null;
        current.completedAt = new Date();
        current.updatedAt = new Date();
        if (current.sourcePhotoId) {
          await this.releaseSourcePhotoInTransaction(
            transaction,
            current.sourcePhotoId,
          );
          current.sourcePhotoId = null;
        }
        await this.quota.incrementInTransaction(transaction, current.userId);
        await transaction.flush();
      });
    } catch (error) {
      await this.scheduleObjectCleanup(task.userId, resultInput.objectKey);
      throw error;
    }
  }

  public async markFailed(task: TryOnTask, failureCode: string): Promise<void> {
    const em = this.tasks.getEntityManager().fork();
    await em.transactional(async (transaction) => {
      const current = await transaction.findOne(
        TryOnTask,
        { id: task.id, status: TryOnTaskStatus.PROCESSING },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!current) return;
      current.status = TryOnTaskStatus.FAILED;
      current.failureCode = failureCode.slice(0, 80);
      current.lockedAt = null;
      current.completedAt = new Date();
      current.updatedAt = new Date();
      if (current.sourcePhotoId) {
        await this.releaseSourcePhotoInTransaction(
          transaction,
          current.sourcePhotoId,
        );
        current.sourcePhotoId = null;
      }
      await transaction.flush();
    });
  }

  public async list(userId: string, query: TryOnTaskQuery) {
    const where: Record<string, unknown> = {
      userId,
      ...(query.status
        ? { status: query.status }
        : { status: { $ne: TryOnTaskStatus.DELETED } }),
    };
    if (query.unread === true) where.notificationReadAt = null;
    if (query.unread === false) where.notificationReadAt = { $ne: null };
    const [items, total] = await this.tasks.findAndCount(where, {
      orderBy: { createdAt: 'DESC' },
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    const resultItems = await Promise.all(
      items.map(async (task) =>
        this.toResponse(task, await this.results.findOne({ taskId: task.id })),
      ),
    );
    return {
      items: resultItems,
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  public async get(userId: string, id: string) {
    const task = await this.tasks.findOne({ id, userId });
    if (!task) throw new NotFoundException('试穿任务不存在');
    return this.toResponse(
      task,
      await this.results.findOne({ taskId: task.id }),
    );
  }

  public async download(userId: string, id: string) {
    const task = await this.tasks.findOne({
      id,
      userId,
      status: TryOnTaskStatus.SUCCEEDED,
    });
    if (!task) throw new NotFoundException('试穿结果不存在');
    const result = await this.results.findOne({
      taskId: task.id,
      userId,
      deletedAt: null,
    });
    if (!result) throw new NotFoundException('试穿结果不存在');
    const ttl = Number(
      this.config.get<string>('TRY_ON_DOWNLOAD_URL_TTL_SECONDS') || 300,
    );
    try {
      return {
        url: await this.objectStore.getPrivateDownloadUrl(
          result.objectKey,
          ttl,
        ),
        expiresInSeconds: ttl,
      };
    } catch {
      throw new ServiceUnavailableException('暂时无法生成下载地址');
    }
  }

  public async readChatResult(userId: string, id: string) {
    const task = await this.tasks.findOne({
      id,
      userId,
      status: TryOnTaskStatus.SUCCEEDED,
      deletedAt: null,
    });
    if (!task) throw new NotFoundException('试穿结果不存在');
    const result = await this.results.findOne({
      taskId: task.id,
      userId,
      deletedAt: null,
    });
    if (
      !result ||
      !CHAT_RESULT_MIME_TYPES.has(result.mimeType) ||
      !Number.isSafeInteger(result.byteSize) ||
      result.byteSize < 1 ||
      result.byteSize > 10 * 1024 * 1024
    ) {
      throw new ServiceUnavailableException('试穿结果暂不可用');
    }
    if (!this.imageProcessing) {
      throw new ServiceUnavailableException('试穿结果暂不可用');
    }

    try {
      const stored = await this.objectStore.getObject(result.objectKey);
      if (stored.byteLength !== result.byteSize) {
        throw new Error('result size mismatch');
      }
      const image = await this.imageProcessing.normalize(stored);
      if (
        image.mimeType !== result.mimeType ||
        image.width !== result.width ||
        image.height !== result.height
      ) {
        throw new Error('result metadata mismatch');
      }
      return {
        taskId: task.id,
        product: {
          externalId: task.productExternalId,
          name: task.productName,
          color: task.color,
        },
        result: {
          width: image.width,
          height: image.height,
          mimeType: image.mimeType,
        },
        image: image.body,
      };
    } catch {
      throw new ServiceUnavailableException('试穿结果暂不可用');
    }
  }

  public async delete(userId: string, id: string): Promise<void> {
    const em = this.tasks.getEntityManager().fork();
    let objectKey: string | null = null;
    await em.transactional(async (transaction) => {
      const task = await transaction.findOne(TryOnTask, {
        id,
        userId,
      });
      if (!task) throw new NotFoundException('试穿结果不存在');
      // 删除接口保持幂等：重复删除本人已删除的结果不泄露资源状态，也不重复创建清理任务。
      if (task.status === TryOnTaskStatus.DELETED) return;
      if (task.status !== TryOnTaskStatus.SUCCEEDED) {
        throw new NotFoundException('试穿结果不存在');
      }
      const result = await transaction.findOne(TryOnResult, {
        taskId: task.id,
        userId,
        deletedAt: null,
      });
      task.status = TryOnTaskStatus.DELETED;
      task.deletedAt = new Date();
      task.updatedAt = new Date();
      if (result) {
        objectKey = result.objectKey;
        result.deletedAt = new Date();
        const cleanup = await transaction.findOne(TryOnObjectCleanup, {
          objectKey: result.objectKey,
        });
        if (cleanup) {
          cleanup.userId = userId;
          cleanup.nextAttemptAt = new Date();
        } else {
          transaction.create(TryOnObjectCleanup, {
            userId,
            objectKey: result.objectKey,
            attempts: 0,
            nextAttemptAt: new Date(),
            lastErrorCode: null,
            createdAt: new Date(),
          });
        }
      }
      await transaction.flush();
    });
    if (objectKey) {
      try {
        await this.objectStore.deleteObject(objectKey);
        const cleanupEm = this.tasks.getEntityManager().fork();
        await cleanupEm.nativeDelete(TryOnObjectCleanup, { objectKey });
      } catch {
        // 墓碑和清理任务已提交；物理删除失败由后台服务重试。
      }
    }
  }

  public async markRead(userId: string, id: string): Promise<void> {
    const task = await this.tasks.findOne({
      id,
      userId,
      status: TryOnTaskStatus.SUCCEEDED,
    });
    if (!task) throw new NotFoundException('试穿任务不存在');
    task.notificationReadAt ??= new Date();
    await this.tasks.getEntityManager().flush();
  }

  private toResponse(task: TryOnTask, result: TryOnResult | null) {
    return {
      id: task.id,
      status: task.status,
      product: {
        externalId: task.productExternalId,
        name: task.productName,
        category: task.productCategory,
        color: task.color,
        imageUrl: task.garmentImageUrl,
      },
      result:
        result && !result.deletedAt
          ? {
              resultId: result.id,
              createdAt: result.createdAt.toISOString(),
              width: result.width,
              height: result.height,
              downloadable: true,
            }
          : null,
      notification: { unread: task.notificationReadAt === null },
      failureCode: task.failureCode,
      createdAt: task.createdAt.toISOString(),
      completedAt: task.completedAt?.toISOString() ?? null,
    };
  }

  private assertEnabled(): void {
    if (this.config.get<string>('TRY_ON_ENABLED') !== 'true') {
      throw new ConflictException('试穿功能暂未开放');
    }
  }

  private async releaseSourcePhotoInTransaction(
    em: EntityManager,
    photoId: string,
  ): Promise<void> {
    const photo = await em.findOne(TryOnPhoto, {
      id: photoId,
      status: TryOnPhotoStatus.ACTIVE,
    });
    if (!photo) return;
    if (photo.kind === TryOnPhotoKind.TEMPORARY) {
      photo.status = TryOnPhotoStatus.DELETED;
      photo.deletedAt = new Date();
      const cleanup = await em.findOne(TryOnObjectCleanup, {
        objectKey: photo.objectKey,
      });
      if (cleanup) {
        cleanup.userId = photo.userId;
        cleanup.nextAttemptAt = new Date();
      } else {
        em.create(TryOnObjectCleanup, {
          userId: photo.userId,
          objectKey: photo.objectKey,
          attempts: 0,
          nextAttemptAt: new Date(),
          lastErrorCode: null,
          createdAt: new Date(),
        });
      }
    }
    // 保存照片可复用；任务结束后解除占用，避免照片永久绑定历史任务。
    photo.taskId = null;
    photo.updatedAt = new Date();
  }

  private async cleanupTaskSourcePhoto(
    taskId: string,
    photoId: string,
  ): Promise<void> {
    const em = this.tasks.getEntityManager().fork();
    await em.transactional(async (transaction) => {
      const task = await transaction.findOne(TryOnTask, { id: taskId });
      if (task?.sourcePhotoId === photoId) task.sourcePhotoId = null;
      await this.releaseSourcePhotoInTransaction(transaction, photoId);
      await transaction.flush();
    });
  }

  private async scheduleObjectCleanup(
    userId: string,
    objectKey: string,
  ): Promise<void> {
    const em = this.tasks.getEntityManager().fork();
    await em.transactional(async (transaction) => {
      const existing = await transaction.findOne(TryOnObjectCleanup, {
        objectKey,
      });
      if (existing) {
        existing.userId = userId;
        existing.nextAttemptAt = new Date();
      } else {
        transaction.create(TryOnObjectCleanup, {
          userId,
          objectKey,
          attempts: 0,
          nextAttemptAt: new Date(),
          lastErrorCode: null,
          createdAt: new Date(),
        });
      }
      await transaction.flush();
    });
  }
}
