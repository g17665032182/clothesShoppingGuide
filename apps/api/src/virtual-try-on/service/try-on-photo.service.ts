import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import type { EntityManager } from '@mikro-orm/core';
import { createHash } from 'node:crypto';

import {
  TryOnPhoto,
  TryOnPhotoKind,
  TryOnPhotoStatus,
} from '../entity/try-on-photo.entity.js';
import { TryOnObjectCleanup } from '../entity/try-on-object-cleanup.entity.js';
import {
  TRY_ON_OBJECT_STORE,
  type TryOnObjectStore,
} from '../port/try-on-object-store.port.js';
import { TryOnImageProcessingService } from './image-processing.service.js';
import type {
  TryOnAvailability,
  TryOnPhotoPageDto,
} from '../dto/try-on-photo.dto.js';

@Injectable()
export class TryOnPhotoService {
  public constructor(
    @InjectRepository(TryOnPhoto)
    private readonly photos: EntityRepository<TryOnPhoto>,
    @Inject(TRY_ON_OBJECT_STORE)
    private readonly objectStore: TryOnObjectStore,
    private readonly imageProcessing: TryOnImageProcessingService,
    private readonly config: ConfigService,
  ) {}

  public async upload(
    userId: string,
    file: { buffer?: Buffer; mimetype?: string; size?: number },
    save: boolean,
  ) {
    this.assertEnabled();
    if (!file?.buffer || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException('请上传图片文件');
    }
    const normalized = await this.imageProcessing.normalize(file.buffer);
    this.assertAllowedFixture(normalized.body);
    const photo = this.photos.create({
      userId,
      kind: save ? TryOnPhotoKind.SAVED : TryOnPhotoKind.TEMPORARY,
      status: TryOnPhotoStatus.ACTIVE,
      objectKey: '',
      mimeType: normalized.mimeType,
      byteSize: normalized.byteSize,
      width: normalized.width,
      height: normalized.height,
      expiresAt: save ? null : new Date(Date.now() + 30 * 60 * 1000),
      taskId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    try {
      photo.objectKey = await this.objectStore.putPhoto({
        userId,
        id: photo.id,
        body: normalized.body,
        mimeType: normalized.mimeType,
      });
      await this.photos.getEntityManager().flush();
      return this.toResponse(photo);
    } catch (error) {
      if (photo.objectKey) {
        await this.scheduleCleanup(userId, photo.objectKey);
        try {
          await this.objectStore.deleteObject(photo.objectKey);
        } catch {
          // 上传失败后的清理由后台清理服务兜底，不能把内部存储错误暴露给客户端。
        }
      }
      throw error;
    }
  }

  public async listSaved(userId: string): Promise<TryOnPhotoPageDto> {
    const rows = await this.photos.find(
      {
        userId,
        kind: TryOnPhotoKind.SAVED,
        status: TryOnPhotoStatus.ACTIVE,
      },
      { orderBy: { createdAt: 'DESC' } },
    );
    return {
      items: rows.map((photo) => this.toResponse(photo)),
      availability: this.getAvailability(),
    };
  }

  public async findOwnedActive(
    userId: string,
    id: string,
  ): Promise<TryOnPhoto> {
    const photo = await this.photos.findOne({
      id,
      userId,
      status: TryOnPhotoStatus.ACTIVE,
    });
    if (!photo) throw new NotFoundException('照片不存在');
    if (photo.expiresAt && photo.expiresAt <= new Date()) {
      await this.markDeleted(photo);
      throw new NotFoundException('照片不存在');
    }
    return photo;
  }

  public async deleteSaved(userId: string, id: string): Promise<void> {
    const photo = await this.photos.findOne({
      id,
      userId,
      kind: TryOnPhotoKind.SAVED,
      status: TryOnPhotoStatus.ACTIVE,
    });
    if (!photo) throw new NotFoundException('照片不存在');
    if (photo.taskId) throw new ConflictException('照片正在任务中使用');
    await this.markDeleted(photo);
  }

  public async bindToTask(
    em: EntityManager,
    userId: string,
    photoId: string,
    taskId: string,
  ): Promise<TryOnPhoto> {
    const photo = await em.findOne(TryOnPhoto, {
      id: photoId,
      userId,
      status: TryOnPhotoStatus.ACTIVE,
    });
    if (!photo || (photo.expiresAt && photo.expiresAt <= new Date())) {
      throw new NotFoundException('照片不存在');
    }
    if (photo.kind === TryOnPhotoKind.TEMPORARY && photo.taskId) {
      throw new ConflictException('照片已被任务占用');
    }
    photo.taskId = taskId;
    photo.expiresAt = null;
    await em.flush();
    return photo;
  }

  public async releaseTemporary(photoId: string): Promise<void> {
    const photo = await this.photos.findOne({
      id: photoId,
      kind: TryOnPhotoKind.TEMPORARY,
      status: TryOnPhotoStatus.ACTIVE,
    });
    if (!photo) return;
    await this.markDeleted(photo);
  }

  private async markDeleted(photo: TryOnPhoto): Promise<void> {
    const em = this.photos.getEntityManager().fork();
    await em.transactional(async (transaction) => {
      const current = await transaction.findOne(TryOnPhoto, {
        id: photo.id,
        userId: photo.userId,
        status: TryOnPhotoStatus.ACTIVE,
      });
      if (!current) return;
      current.status = TryOnPhotoStatus.DELETED;
      current.deletedAt = new Date();
      current.updatedAt = new Date();
      const existing = await transaction.findOne(TryOnObjectCleanup, {
        objectKey: current.objectKey,
      });
      if (existing) {
        existing.userId = current.userId;
        existing.nextAttemptAt = new Date();
      } else {
        transaction.create(TryOnObjectCleanup, {
          userId: current.userId,
          objectKey: current.objectKey,
          attempts: 0,
          nextAttemptAt: new Date(),
          lastErrorCode: null,
          createdAt: new Date(),
        });
      }
      await transaction.flush();
    });
    try {
      await this.objectStore.deleteObject(photo.objectKey);
    } catch {
      // 数据库墓碑先落地；清理服务稍后重试物理删除。
    }
  }

  private assertAllowedFixture(buffer: Buffer): void {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      if (this.config.get<string>('TRY_ON_REAL_PHOTOS_ENABLED') === 'true')
        return;
      throw new BadRequestException('生产环境尚未开放真实人像试穿');
    }
    const configured = this.getAllowedTestImageHashes();
    if (!configured.length) {
      throw new BadRequestException('当前环境未开放试穿测试图片');
    }
    const digest = createHash('sha256').update(buffer).digest('hex');
    if (!configured.includes(digest)) {
      throw new BadRequestException('仅允许已登记的测试图片');
    }
  }

  private getAvailability(): TryOnAvailability {
    // 仅返回准入状态；不向浏览器暴露测试图片摘要或第三方配置。
    if (this.config.get<string>('TRY_ON_ENABLED') !== 'true') return 'disabled';
    if (this.config.get<string>('NODE_ENV') === 'production') {
      return this.config.get<string>('TRY_ON_REAL_PHOTOS_ENABLED') === 'true'
        ? 'available'
        : 'disabled';
    }
    return this.getAllowedTestImageHashes().length
      ? 'test_only'
      : 'test_images_unconfigured';
  }

  private getAllowedTestImageHashes(): string[] {
    const configured = this.config
      .get<string>('TRY_ON_ALLOWED_TEST_IMAGE_SHA256')
      ?.split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (
      !configured?.length ||
      configured.some((value) => !/^[a-f0-9]{64}$/u.test(value))
    ) {
      return [];
    }
    return configured;
  }

  private assertEnabled(): void {
    if (this.config.get<string>('TRY_ON_ENABLED') !== 'true') {
      throw new ConflictException('试穿功能暂未开放');
    }
  }

  private async scheduleCleanup(
    userId: string | null,
    objectKey: string,
  ): Promise<void> {
    const em = this.photos.getEntityManager().fork();
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

  private toResponse(photo: TryOnPhoto) {
    return {
      id: photo.id,
      kind: photo.kind,
      mimeType: photo.mimeType,
      byteSize: photo.byteSize,
      width: photo.width,
      height: photo.height,
      createdAt: photo.createdAt.toISOString(),
    };
  }
}
