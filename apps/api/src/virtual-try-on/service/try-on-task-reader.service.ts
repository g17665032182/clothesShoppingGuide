import { Injectable } from '@nestjs/common';
import { IsolationLevel } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import {
  tryOnTaskMetadataPageSchema,
  tryOnTaskMetadataQuerySchema,
  type TryOnTaskMetadataPage,
  type TryOnTaskMetadataQuery,
} from '../dto/try-on-task-metadata.dto.js';
import { TryOnTask, TryOnTaskStatus } from '../entity/try-on-task.entity.js';
import { TryOnResult } from '../entity/try-on-result.entity.js';

const visibleStatuses = [
  TryOnTaskStatus.QUEUED,
  TryOnTaskStatus.PROCESSING,
  TryOnTaskStatus.SUCCEEDED,
  TryOnTaskStatus.FAILED,
];

@Injectable()
export class TryOnTaskReaderService {
  public constructor(
    @InjectRepository(TryOnTask)
    private readonly tasks: EntityRepository<TryOnTask>,
  ) {}

  public async listMetadataForUser(
    userId: string,
    query: TryOnTaskMetadataQuery,
  ): Promise<TryOnTaskMetadataPage> {
    const input = tryOnTaskMetadataQuerySchema.parse(query);
    const em = this.tasks.getEntityManager().fork({
      clear: true,
      useContext: false,
      keepTransactionContext: false,
    });

    // 独立只读快照保证总数、当前页和结果存在性属于同一次读取。
    return em.transactional(
      async (transaction) => {
        const [tasks, total] = await transaction.findAndCount(
          TryOnTask,
          {
            userId,
            deletedAt: null,
            status: {
              $in: input.status
                ? [input.status as TryOnTaskStatus]
                : visibleStatuses,
            },
          },
          {
            fields: [
              'id',
              'status',
              'productExternalId',
              'productName',
              'productCategory',
              'color',
              'createdAt',
              'completedAt',
            ],
            orderBy: { createdAt: 'DESC', id: 'DESC' },
            limit: 5,
            offset: (input.page - 1) * 5,
          },
        );
        const results =
          tasks.length === 0
            ? []
            : await transaction.find(
                TryOnResult,
                {
                  userId,
                  taskId: { $in: tasks.map((task) => task.id) },
                  deletedAt: null,
                },
                { fields: ['taskId'] },
              );
        const resultTaskIds = new Set(results.map((result) => result.taskId));

        // 显式投影后再校验；损坏条目使整个 section 失败，不能静默丢弃。
        return tryOnTaskMetadataPageSchema.parse({
          items: tasks.map((task) => ({
            taskId: task.id,
            status: task.status,
            product: {
              externalId: task.productExternalId,
              name: task.productName,
              category: task.productCategory,
              color: task.color,
            },
            createdAt: task.createdAt.toISOString(),
            completedAt: task.completedAt?.toISOString() ?? null,
            resultAvailable:
              task.status === TryOnTaskStatus.SUCCEEDED &&
              resultTaskIds.has(task.id),
          })),
          page: input.page,
          pageSize: 5,
          total,
        });
      },
      { isolationLevel: IsolationLevel.REPEATABLE_READ, readOnly: true },
    );
  }
}
