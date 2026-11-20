import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';

import { ConflictException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/core';
import type { EntityRepository } from '@mikro-orm/postgresql';

import {
  ReturnRefundApplication,
  ReturnRefundStatus,
} from '../entity/return-refund-application.entity.js';
import { ReturnRefundEvidence } from '../entity/return-refund-evidence.entity.js';
import type { ReturnRefundEvidenceStore } from '../port/return-refund-evidence-store.port.js';
import { ReturnRefundEvidenceService } from '../service/return-refund-evidence.service.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const applicationId = '33333333-3333-4333-8333-333333333333';
const evidenceId = '44444444-4444-4444-8444-444444444444';
const now = new Date('2026-11-19T04:00:00.000Z');

function makeApplication(
  overrides: Partial<ReturnRefundApplication> = {},
): ReturnRefundApplication {
  return Object.assign(new ReturnRefundApplication(), {
    id: applicationId,
    orderId: '55555555-5555-4555-8555-555555555555',
    userId: ownerId,
    orderNo: 'OD-EVIDENCE',
    status: ReturnRefundStatus.PENDING_USER_SUBMISSION,
    reason: '测试原因',
    refundAmount: '10.00',
    currency: 'CNY',
    idempotencyKey: '66666666-6666-4666-8666-666666666666',
    requestHash: 'hash',
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

function makeEvidence(
  overrides: Partial<ReturnRefundEvidence> = {},
): ReturnRefundEvidence {
  return Object.assign(new ReturnRefundEvidence(), {
    id: evidenceId,
    applicationId,
    objectKey: `return-refund/${ownerId}/${applicationId}/${evidenceId}.png`,
    mediaType: 'image/png',
    byteSize: 32,
    sha256: 'a'.repeat(64),
    deletedAt: null,
    createdAt: now,
    ...overrides,
  });
}

function fixture(
  options: {
    owner?: string;
    status?: ReturnRefundStatus;
    evidence?: ReturnRefundEvidence[];
  } = {},
) {
  let application = makeApplication({
    userId: options.owner ?? ownerId,
    status: options.status ?? ReturnRefundStatus.PENDING_USER_SUBMISSION,
  });
  let evidenceRows = options.evidence ?? [];
  const storageCalls: Array<{ action: string; key?: string }> = [];
  let flushCount = 0;

  function makeEm(): EntityManager {
    const em = {
      getTransactionContext: () => ({}),
      getConnection: () => ({
        async execute() {
          return [{ now: new Date(now) }];
        },
      }),
      async findOne(entity: unknown, where: Record<string, unknown>) {
        if (entity === ReturnRefundApplication)
          return where.id === application.id &&
            (where.userId === undefined || where.userId === application.userId)
            ? application
            : null;
        if (entity === ReturnRefundEvidence)
          return (
            evidenceRows.find(
              (row) =>
                row.id === where.id &&
                row.applicationId === where.applicationId &&
                (where.deletedAt === undefined ||
                  row.deletedAt === where.deletedAt),
            ) ?? null
          );
        return null;
      },
      async count(entity: unknown, where: Record<string, unknown>) {
        if (entity !== ReturnRefundEvidence) return 0;
        return evidenceRows.filter(
          (row) =>
            row.applicationId === where.applicationId && row.deletedAt === null,
        ).length;
      },
      create(entity: unknown, data: Record<string, unknown>) {
        assert.equal(entity, ReturnRefundEvidence);
        const row = Object.assign(new ReturnRefundEvidence(), data);
        evidenceRows = [...evidenceRows, row];
        return row;
      },
      remove(row: ReturnRefundEvidence) {
        evidenceRows = evidenceRows.filter((candidate) => candidate !== row);
      },
      async flush() {
        flushCount += 1;
      },
      async transactional<T>(
        callback: (transaction: EntityManager) => Promise<T>,
      ): Promise<T> {
        const previousApplication = application;
        const previousEvidence = [...evidenceRows];
        try {
          return await callback(makeEm());
        } catch (error) {
          application = previousApplication;
          evidenceRows = previousEvidence;
          throw error;
        }
      },
    };
    return em as unknown as EntityManager;
  }

  const store: ReturnRefundEvidenceStore = {
    async put(input) {
      storageCalls.push({ action: 'put' });
      return `return-refund/${input.userId}/${input.applicationId}/${input.evidenceId}.${input.extension}`;
    },
    async get(key) {
      storageCalls.push({ action: 'get', key });
      return Buffer.alloc(32);
    },
    async delete(key) {
      storageCalls.push({ action: 'delete', key });
    },
  };
  const repository = {
    getEntityManager: () => ({ fork: () => makeEm() }),
    async findOne(where: Record<string, unknown>) {
      if ('userId' in where)
        return where.id === applicationId && where.userId === application.userId
          ? application
          : null;
      if (where.applicationId !== applicationId || where.deletedAt !== null)
        return null;
      return (
        evidenceRows.find(
          (row) => row.id === where.id && row.deletedAt === null,
        ) ?? null
      );
    },
    async find(where: Record<string, unknown>) {
      return evidenceRows.filter(
        (row) =>
          row.applicationId === where.applicationId && row.deletedAt === null,
      );
    },
  };
  const service = new ReturnRefundEvidenceService(
    repository as unknown as EntityRepository<ReturnRefundApplication>,
    repository as unknown as EntityRepository<ReturnRefundEvidence>,
    store,
  );
  return {
    service,
    storageCalls,
    get application() {
      return application;
    },
    get evidenceRows() {
      return evidenceRows;
    },
    get flushCount() {
      return flushCount;
    },
  };
}

async function smallPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 30, g: 60, b: 90 },
    },
  })
    .png()
    .toBuffer();
}

test('上传成功仅返回安全元数据并把对象键留在私有存储', async () => {
  const subject = fixture();
  const file = await smallPng();
  const result = await subject.service.uploadForUser(ownerId, applicationId, {
    buffer: file,
    mimetype: 'image/png',
  });

  assert.equal(result.mediaType, 'image/png');
  assert.equal(result.byteSize, file.byteLength);
  assert.equal('objectKey' in result, false);
  assert.equal(subject.evidenceRows.length, 1);
  assert.deepEqual(
    subject.storageCalls.map((call) => call.action),
    ['put'],
  );
});

test('超额、外人订单和非编辑状态拒绝上传且失败清理对象', async () => {
  const full = fixture({
    evidence: Array.from({ length: 5 }, (_, index) =>
      makeEvidence({
        id: `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`,
      }),
    ),
  });
  await assert.rejects(
    full.service.uploadForUser(ownerId, applicationId, {
      buffer: await smallPng(),
      mimetype: 'image/png',
    }),
    (error: unknown) =>
      error instanceof ConflictException && error.getStatus() === 409,
  );
  assert.deepEqual(
    full.storageCalls.map((call) => call.action),
    ['put', 'delete'],
  );
  assert.equal(full.evidenceRows.length, 5);

  const foreign = fixture({ owner: otherUserId });
  await assert.rejects(
    foreign.service.uploadForUser(ownerId, applicationId, {
      buffer: await smallPng(),
      mimetype: 'image/png',
    }),
    (error: unknown) =>
      error instanceof NotFoundException && error.getStatus() === 404,
  );
  assert.deepEqual(foreign.storageCalls, []);

  const closed = fixture({
    status: ReturnRefundStatus.APPROVED_PENDING_RETURN,
  });
  await assert.rejects(
    closed.service.uploadForUser(ownerId, applicationId, {
      buffer: await smallPng(),
      mimetype: 'image/png',
    }),
    (error: unknown) =>
      error instanceof ConflictException && error.getStatus() === 409,
  );
  assert.deepEqual(
    closed.storageCalls.map((call) => call.action),
    ['put', 'delete'],
  );
});

test('用户和管理员下载都经授权记录读取，不返回对象地址', async () => {
  const row = makeEvidence();
  const subject = fixture({ evidence: [row] });
  const userDownload = await subject.service.downloadForUser(
    ownerId,
    applicationId,
    evidenceId,
  );
  const adminDownload = await subject.service.downloadForAdmin(
    applicationId,
    evidenceId,
  );
  assert.equal(userDownload.mediaType, 'image/png');
  assert.equal(userDownload.body.byteLength, row.byteSize);
  assert.equal(adminDownload.fileName, `evidence-${evidenceId}.png`);
  assert.deepEqual(
    subject.storageCalls.map((call) => call.action),
    ['get', 'get'],
  );
  await assert.rejects(
    subject.service.downloadForUser(otherUserId, applicationId, evidenceId),
    (error: unknown) =>
      error instanceof NotFoundException && error.getStatus() === 404,
  );
});

test('删除仅限本人可编辑申请', async () => {
  const row = makeEvidence();
  const editable = fixture({ evidence: [row] });
  await editable.service.deleteForUser(ownerId, applicationId, evidenceId);
  assert.equal(editable.evidenceRows.length, 1);
  assert.ok(editable.evidenceRows[0]?.deletedAt instanceof Date);
  assert.deepEqual(
    editable.storageCalls.map((call) => call.action),
    ['delete'],
  );
  await assert.rejects(
    editable.service.downloadForUser(ownerId, applicationId, evidenceId),
    (error: unknown) =>
      error instanceof NotFoundException && error.getStatus() === 404,
  );

  const notEditable = fixture({
    status: ReturnRefundStatus.APPROVED_PENDING_RETURN,
    evidence: [row],
  });
  await assert.rejects(
    notEditable.service.deleteForUser(ownerId, applicationId, evidenceId),
    (error: unknown) =>
      error instanceof ConflictException && error.getStatus() === 409,
  );
  assert.deepEqual(notEditable.storageCalls, []);
});
