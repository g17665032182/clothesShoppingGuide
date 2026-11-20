import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LockMode, type EntityManager } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import { ReturnRefundApplication } from '../entity/return-refund-application.entity.js';
import { ReturnRefundStatus } from '../entity/return-refund-application.entity.js';
import { ReturnRefundEvidence } from '../entity/return-refund-evidence.entity.js';
import {
  RETURN_REFUND_EVIDENCE_STORE,
  type ReturnRefundEvidenceStore,
} from '../port/return-refund-evidence-store.port.js';
import {
  inspectReturnRefundEvidence,
  MAX_RETURN_REFUND_EVIDENCE_PER_APPLICATION,
  MAX_RETURN_REFUND_IMAGE_BYTES,
  MAX_RETURN_REFUND_VIDEO_BYTES,
  RETURN_REFUND_MEDIA_TYPE_EXTENSIONS,
  type ReturnRefundEvidenceFileType,
} from './return-refund-evidence-file.js';

const editableStatuses = [
  ReturnRefundStatus.PENDING_USER_SUBMISSION,
  ReturnRefundStatus.PENDING_REVIEW,
];

export type ReturnRefundEvidenceMetadata = {
  id: string;
  mediaType: ReturnRefundEvidenceFileType['mediaType'];
  byteSize: number;
  createdAt: string;
};

export type ReturnRefundEvidenceDownload = {
  body: Buffer;
  mediaType: ReturnRefundEvidenceFileType['mediaType'];
  fileName: string;
};

@Injectable()
export class ReturnRefundEvidenceService {
  public constructor(
    @InjectRepository(ReturnRefundApplication)
    private readonly applications: EntityRepository<ReturnRefundApplication>,
    @InjectRepository(ReturnRefundEvidence)
    private readonly evidence: EntityRepository<ReturnRefundEvidence>,
    @Inject(RETURN_REFUND_EVIDENCE_STORE)
    private readonly store: ReturnRefundEvidenceStore,
  ) {}

  public async uploadForUser(
    userId: string,
    applicationId: string,
    file: { buffer?: Buffer; mimetype?: string },
  ): Promise<ReturnRefundEvidenceMetadata> {
    if (!file?.buffer || !Buffer.isBuffer(file.buffer))
      throw new BadRequestException('请上传凭证文件');
    const type = await inspectReturnRefundEvidence(file.buffer, file.mimetype);
    const candidate = await this.applications.findOne({
      id: applicationId,
      userId,
    });
    if (!candidate) throw new NotFoundException('售后申请不存在');

    const evidenceId = randomUUID();
    const objectKey = await this.store.put({
      userId,
      applicationId,
      evidenceId,
      extension: type.extension,
      body: file.buffer,
    });
    try {
      const em = this.manager();
      const row = await em.transactional(async (transaction) => {
        const application = await transaction.findOne(
          ReturnRefundApplication,
          { id: applicationId, userId },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        if (!application) throw new NotFoundException('售后申请不存在');
        if (!editableStatuses.includes(application.status))
          throw new ConflictException('申请当前状态不能上传凭证');
        const count = await transaction.count(ReturnRefundEvidence, {
          applicationId,
          deletedAt: null,
        });
        if (count >= MAX_RETURN_REFUND_EVIDENCE_PER_APPLICATION)
          throw new ConflictException('每笔申请最多上传 5 份凭证');
        const evidence = transaction.create(ReturnRefundEvidence, {
          id: evidenceId,
          applicationId,
          objectKey,
          mediaType: type.mediaType,
          byteSize: file.buffer!.byteLength,
          sha256: createHash('sha256').update(file.buffer!).digest('hex'),
          createdAt: await this.databaseNow(transaction),
        });
        await transaction.flush();
        return evidence;
      });
      return this.toMetadata(row);
    } catch (error) {
      try {
        await this.store.delete(objectKey);
      } catch {
        // 私有对象没有元数据引用；下载接口不会暴露该残留对象。
      }
      throw error;
    }
  }

  public async deleteForUser(
    userId: string,
    applicationId: string,
    evidenceId: string,
  ): Promise<void> {
    const em = this.manager();
    const objectKey = await em.transactional(async (transaction) => {
      const application = await transaction.findOne(
        ReturnRefundApplication,
        { id: applicationId, userId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!application) throw new NotFoundException('售后申请不存在');
      if (!editableStatuses.includes(application.status))
        throw new ConflictException('申请当前状态不能删除凭证');
      const evidence = await transaction.findOne(
        ReturnRefundEvidence,
        { id: evidenceId, applicationId, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!evidence) throw new NotFoundException('凭证不存在');
      evidence.deletedAt = await this.databaseNow(transaction);
      await transaction.flush();
      return evidence.objectKey;
    });
    // 先提交墓碑；对象删除失败时也不会再通过下载 API 暴露文件。
    await this.store.delete(objectKey);
  }

  public async downloadForUser(
    userId: string,
    applicationId: string,
    evidenceId: string,
  ): Promise<ReturnRefundEvidenceDownload> {
    const application = await this.applications.findOne({
      id: applicationId,
      userId,
    });
    if (!application) throw new NotFoundException('凭证不存在');
    const row = await this.evidence.findOne({
      id: evidenceId,
      applicationId,
      deletedAt: null,
    });
    if (!row) throw new NotFoundException('凭证不存在');
    return this.readObject(row);
  }

  public async downloadForAdmin(
    applicationId: string,
    evidenceId: string,
  ): Promise<ReturnRefundEvidenceDownload> {
    const row = await this.evidence.findOne({
      id: evidenceId,
      applicationId,
      deletedAt: null,
    });
    if (!row) throw new NotFoundException('凭证不存在');
    return this.readObject(row);
  }

  public async listForApplication(
    applicationId: string,
  ): Promise<ReturnRefundEvidenceMetadata[]> {
    const rows = await this.evidence.find(
      { applicationId, deletedAt: null },
      { orderBy: [{ createdAt: 'ASC' }, { id: 'ASC' }] },
    );
    return rows.map((row) => this.toMetadata(row));
  }

  private async readObject(
    row: ReturnRefundEvidence,
  ): Promise<ReturnRefundEvidenceDownload> {
    const maxBytes =
      row.mediaType === 'video/mp4'
        ? MAX_RETURN_REFUND_VIDEO_BYTES
        : MAX_RETURN_REFUND_IMAGE_BYTES;
    if (row.byteSize > maxBytes)
      throw new ServiceUnavailableException('凭证暂不可用');
    const body = await this.store.get(row.objectKey, maxBytes);
    if (body.byteLength !== row.byteSize)
      throw new ServiceUnavailableException('凭证暂不可用');
    const extension =
      RETURN_REFUND_MEDIA_TYPE_EXTENSIONS[
        row.mediaType as ReturnRefundEvidenceFileType['mediaType']
      ];
    if (!extension) throw new ServiceUnavailableException('凭证暂不可用');
    return {
      body,
      mediaType: row.mediaType as ReturnRefundEvidenceFileType['mediaType'],
      fileName: `evidence-${row.id}.${extension}`,
    };
  }

  private toMetadata(row: ReturnRefundEvidence): ReturnRefundEvidenceMetadata {
    return {
      id: row.id,
      mediaType: row.mediaType as ReturnRefundEvidenceMetadata['mediaType'],
      byteSize: row.byteSize,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async databaseNow(em: EntityManager): Promise<Date> {
    const rows = await em
      .getConnection()
      .execute<Array<{ now: Date | string }>>(
        'select clock_timestamp() as now',
        [],
        'all',
        em.getTransactionContext(),
      );
    const value = rows[0]?.now;
    const date = value instanceof Date ? value : new Date(value ?? '');
    if (!Number.isFinite(date.getTime()))
      throw new ServiceUnavailableException('售后服务暂不可用');
    return date;
  }

  private manager(): EntityManager {
    return this.applications.getEntityManager().fork();
  }
}
