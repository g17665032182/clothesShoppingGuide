import { EntityManager } from '@mikro-orm/core';
import { Seeder } from '@mikro-orm/seeder';

export class DatabaseSeeder extends Seeder {
  public async run(_em: EntityManager): Promise<void> {
    // 当前项目还没有业务 Entity，保留空入口以便后续接入用户和商品初始化数据。
  }
}
