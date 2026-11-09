import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import { TryOnTask, TryOnTaskStatus } from '../entity/try-on-task.entity.js';

@Injectable()
export class TryOnNotificationService {
  public constructor(
    @InjectRepository(TryOnTask)
    private readonly tasks: EntityRepository<TryOnTask>,
  ) {}

  public async markRead(userId: string, taskId: string): Promise<void> {
    const task = await this.tasks.findOne({
      id: taskId,
      userId,
      status: TryOnTaskStatus.SUCCEEDED,
    });
    if (!task) throw new NotFoundException('试穿任务不存在');
    task.notificationReadAt ??= new Date();
    await this.tasks.getEntityManager().flush();
  }
}
