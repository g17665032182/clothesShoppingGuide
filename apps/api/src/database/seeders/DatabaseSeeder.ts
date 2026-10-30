import { EntityManager } from '@mikro-orm/core';
import { Seeder } from '@mikro-orm/seeder';
import { hash } from 'bcryptjs';

import { User, UserRole, UserStatus } from '../../users/entity/user.entity.js';

export class DatabaseSeeder extends Seeder {
  public async run(em: EntityManager): Promise<void> {
    // Seeder 使用环境变量控制管理员账号，重复执行时保持幂等。
    const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com')
      .trim()
      .toLowerCase();
    const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
    const displayName = process.env.SEED_ADMIN_DISPLAY_NAME ?? '系统管理员';
    const existing = await em.findOne(User, { email });

    if (existing) {
      return;
    }

    em.create(User, {
      email,
      passwordHash: await hash(password, 12),
      displayName,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await em.flush();
  }
}
