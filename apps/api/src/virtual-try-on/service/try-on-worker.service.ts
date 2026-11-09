import { lookup } from 'node:dns/promises';
import type { LookupOptions } from 'node:dns';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@mikro-orm/nestjs';
import { MikroORM, RequestContext } from '@mikro-orm/core';
import { EntityRepository } from '@mikro-orm/postgresql';

import { TryOnPhoto, TryOnPhotoStatus } from '../entity/try-on-photo.entity.js';
import { TryOnTask } from '../entity/try-on-task.entity.js';
import {
  PRODUCT_TRY_ON_IMAGE_STORE,
  type ProductTryOnImageStore,
} from '../../product-catalog/index.js';
import {
  TRY_ON_IMAGE_PROVIDER,
  TryOnProviderError,
  type TryOnImageProvider,
} from '../port/try-on-image-provider.port.js';
import {
  TRY_ON_OBJECT_STORE,
  type TryOnObjectStore,
} from '../port/try-on-object-store.port.js';
import { TryOnImageProcessingService } from './image-processing.service.js';
import { TryOnTaskService } from './try-on-task.service.js';

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const BATCH_SIZE = 2;
const MAX_REMOTE_IMAGE_BYTES = 10 * 1024 * 1024;
const FAILURE_CODES = new Set([
  'TRANSIENT_PROVIDER_ERROR',
  'PROVIDER_REJECTED',
  'INVALID_PROVIDER_OUTPUT',
  'PROVIDER_TIMEOUT',
  'IMAGE_UNAVAILABLE',
  'STORAGE_UNAVAILABLE',
]);

type WorkerTaskService = TryOnTaskService & {
  recoverExpiredProcessing(): Promise<void>;
  claimBatch(limit: number): Promise<TryOnTask[]>;
  markSucceeded(
    task: TryOnTask,
    result: {
      resultId: string;
      objectKey: string;
      mimeType: string;
      byteSize: number;
      width: number;
      height: number;
      providerRequestId: string | null;
    },
  ): Promise<void>;
  markFailed(task: TryOnTask, code: string): Promise<void>;
  scheduleRetry(task: TryOnTask, code: string, delayMs: number): Promise<void>;
};

@Injectable()
export class TryOnWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TryOnWorkerService.name);
  private timer: NodeJS.Timeout | undefined;
  private work: Promise<void> | undefined;
  private stopped = false;
  private nextFailureLogAt = 0;

  public constructor(
    private readonly taskService: TryOnTaskService,
    @InjectRepository(TryOnPhoto)
    private readonly photos: EntityRepository<TryOnPhoto>,
    @Inject(TRY_ON_IMAGE_PROVIDER)
    private readonly provider: TryOnImageProvider,
    @Inject(TRY_ON_OBJECT_STORE)
    private readonly objectStore: TryOnObjectStore,
    private readonly imageProcessing: TryOnImageProcessingService,
    private readonly config: ConfigService,
    @Inject(MikroORM) private readonly orm: MikroORM,
    @Inject(PRODUCT_TRY_ON_IMAGE_STORE)
    private readonly productImages: ProductTryOnImageStore,
  ) {}

  public onModuleInit(): void {
    const interval = this.readPositiveInteger(
      'TRY_ON_POLL_INTERVAL_MS',
      DEFAULT_POLL_INTERVAL_MS,
    );
    this.timer = setInterval(() => this.startPoll(), interval);
    this.timer.unref();
    this.startPoll();
  }

  public async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.work;
  }

  private startPoll(): void {
    if (this.stopped || this.work) return;
    this.work = RequestContext.create(this.orm.em, () => this.poll()).finally(
      () => {
        this.work = undefined;
      },
    );
  }

  private async poll(): Promise<void> {
    const tasks = this.taskService as WorkerTaskService;
    try {
      await tasks.recoverExpiredProcessing();
      const batch = await tasks.claimBatch(BATCH_SIZE);
      for (const task of batch) {
        if (this.stopped) return;
        try {
          await this.process(task);
        } catch (error) {
          const code = this.failureCode(error);
          if (
            error instanceof TryOnProviderError &&
            (code === 'TRANSIENT_PROVIDER_ERROR' ||
              code === 'PROVIDER_TIMEOUT') &&
            task.attempts < 2
          ) {
            await tasks.scheduleRetry(task, code, 1_000);
          } else {
            await tasks.markFailed(task, code);
          }
          this.logFailure(task.id, code);
        }
      }
      if (batch.length > 0) this.nextFailureLogAt = 0;
    } catch {
      this.logFailure();
    }
  }

  private async process(task: TryOnTask): Promise<void> {
    if (
      !task.sourcePhotoId ||
      (!task.garmentImageUrl && !task.garmentImageObjectKey)
    )
      throw new TryOnProviderError('INVALID_PROVIDER_OUTPUT');
    const photo = await this.photos.findOne({
      id: task.sourcePhotoId,
      userId: task.userId,
      status: TryOnPhotoStatus.ACTIVE,
    });
    if (!photo) throw new TryOnProviderError('INVALID_PROVIDER_OUTPUT');

    const [personRaw, garmentRaw] = await Promise.all([
      this.objectStore.getObject(photo.objectKey),
      task.garmentImageObjectKey
        ? this.productImages.getObject(task.garmentImageObjectKey)
        : this.fetchPublicImage(task.garmentImageUrl!),
    ]);
    const person = await this.imageProcessing.normalize(personRaw);
    const garment = await this.imageProcessing.normalize(garmentRaw);
    const generated = await this.provider.generate({
      person: person.body,
      garment: garment.body,
      model:
        task.providerModel?.trim() ||
        this.config.get<string>('TRY_ON_MODEL')?.trim() ||
        'gpt-image-2.6-flare',
      prompt:
        '将第二张图片中的服装自然地穿到第一张图片的人物身上。保留人物姿势、脸部、身体比例和原始背景，只替换服装；不要添加文字、徽标或其他人物。结果仅供视觉参考。',
      signal: AbortSignal.timeout(
        this.readPositiveInteger('TRY_ON_PROCESSING_TIMEOUT_MS', 180_000),
      ),
    });
    const normalized = await this.imageProcessing.normalize(generated.image);
    const resultId = randomUUID();
    const objectKey = await this.objectStore.putResult({
      userId: task.userId,
      id: resultId,
      body: normalized.body,
      mimeType: normalized.mimeType,
    });
    try {
      await (this.taskService as WorkerTaskService).markSucceeded(task, {
        resultId,
        objectKey,
        mimeType: normalized.mimeType,
        byteSize: normalized.byteSize,
        width: normalized.width,
        height: normalized.height,
        providerRequestId: generated.providerRequestId,
      });
    } catch (error) {
      try {
        await this.objectStore.deleteObject(objectKey);
      } catch {
        // 结果已登记失败时由清理任务兜底，不能泄露存储错误。
      }
      throw error;
    }
  }

  private async fetchPublicImage(value: string): Promise<Buffer> {
    const url = this.parsePublicImageUrl(value);
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (
      !addresses.length ||
      addresses.some((entry) => this.isPrivateAddress(entry.address))
    )
      throw new TryOnProviderError('PROVIDER_REJECTED');

    const address = addresses[0];
    if (!address) throw new TryOnProviderError('PROVIDER_REJECTED');
    return new Promise<Buffer>((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: { Host: url.host, Accept: 'image/*' },
          timeout: 30_000,
          lookup: (
            _hostname: string,
            _options: LookupOptions,
            callback: (
              error: NodeJS.ErrnoException | null,
              address: string,
              family: number,
            ) => void,
          ) => callback(null, address.address, address.family),
          ...(url.protocol === 'https:' && !isIP(url.hostname)
            ? { servername: url.hostname }
            : {}),
        },
        (response) => {
          if (
            !response.statusCode ||
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            response.resume();
            reject(new TryOnProviderError('TRANSIENT_PROVIDER_ERROR'));
            return;
          }
          const declaredLength = Number(response.headers['content-length']);
          if (
            Number.isFinite(declaredLength) &&
            declaredLength > MAX_REMOTE_IMAGE_BYTES
          ) {
            response.resume();
            reject(new TryOnProviderError('INVALID_PROVIDER_OUTPUT'));
            return;
          }
          const chunks: Buffer[] = [];
          let length = 0;
          response.on('data', (chunk: Buffer) => {
            length += chunk.byteLength;
            if (length > MAX_REMOTE_IMAGE_BYTES) {
              request.destroy();
              reject(new TryOnProviderError('INVALID_PROVIDER_OUTPUT'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => resolve(Buffer.concat(chunks, length)));
          response.on('error', () =>
            reject(new TryOnProviderError('TRANSIENT_PROVIDER_ERROR')),
          );
        },
      );
      request.on('timeout', () => {
        request.destroy();
        reject(new TryOnProviderError('PROVIDER_TIMEOUT'));
      });
      request.on('error', () =>
        reject(new TryOnProviderError('TRANSIENT_PROVIDER_ERROR')),
      );
      request.end();
    });
  }

  private parsePublicImageUrl(value: string): URL {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new TryOnProviderError('PROVIDER_REJECTED');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    )
      throw new TryOnProviderError('PROVIDER_REJECTED');
    return url;
  }

  private isPrivateAddress(value: string): boolean {
    const version = isIP(value);
    if (version === 4) {
      const octets = value.split('.').map(Number);
      const a = octets[0] ?? -1;
      const b = octets[1] ?? -1;
      return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 192 && b === 0) ||
        (a === 192 && b === 2) ||
        (a === 192 && b === 88) ||
        (a === 198 && (b === 18 || b === 19 || b === 51)) ||
        (a === 203 && b === 0 && octets[2] === 113) ||
        a >= 224
      );
    }
    if (version === 6) {
      const address = this.parseIpv6(value);
      if (address === null) return true;
      const ipv4MappedPrefix = address >> 32n;
      if (ipv4MappedPrefix === 0xffffn) {
        const ipv4 = Number(address & 0xffffffffn);
        return this.isPrivateAddress(
          `${(ipv4 >>> 24) & 255}.${(ipv4 >>> 16) & 255}.${(ipv4 >>> 8) & 255}.${ipv4 & 255}`,
        );
      }
      const globalUnicast = address >> 125n === 1n;
      const documentation = address >> 96n === 0x20010db8n;
      const sixToFour = address >> 112n === 0x2002n;
      const documentationV2 = address >> 108n === 0x3fff0n;
      return !globalUnicast || documentation || sixToFour || documentationV2;
    }
    return true;
  }

  private parseIpv6(value: string): bigint | null {
    let address = value.toLowerCase();
    const ipv4Tail = address.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (ipv4Tail) {
      const octets = ipv4Tail[1]!.split('.').map(Number);
      if (octets.some((octet) => octet > 255)) return null;
      const high = ((octets[0]! << 8) | octets[1]!).toString(16);
      const low = ((octets[2]! << 8) | octets[3]!).toString(16);
      address = address.replace(ipv4Tail[1]!, `${high}:${low}`);
    }
    const halves = address.split('::');
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0]!.split(':') : [];
    const right = halves[1] ? halves[1]!.split(':') : [];
    const missing = 8 - left.length - right.length;
    if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
    const groups = [...left, ...Array(missing).fill('0'), ...right];
    if (
      groups.length !== 8 ||
      groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))
    )
      return null;
    return groups.reduce(
      (result, group) => (result << 16n) | BigInt(`0x${group}`),
      0n,
    );
  }

  private failureCode(error: unknown): string {
    const code =
      error instanceof TryOnProviderError ? error.code : 'IMAGE_UNAVAILABLE';
    return FAILURE_CODES.has(code) ? code : 'IMAGE_UNAVAILABLE';
  }

  private logFailure(taskId?: string, code = 'TASK_POLL_FAILED'): void {
    if (Date.now() < this.nextFailureLogAt) return;
    this.nextFailureLogAt = Date.now() + 30_000;
    this.logger.warn({
      context: TryOnWorkerService.name,
      code,
      ...(taskId ? { taskId } : {}),
    });
  }

  private readPositiveInteger(name: string, fallback: number): number {
    const value = Number(this.config.get<string | number>(name) ?? fallback);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }
}
