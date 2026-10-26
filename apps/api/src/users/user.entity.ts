import { randomUUID } from 'node:crypto';

import {
  Entity,
  Enum,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
}

export enum UserStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled',
}

@Entity({ tableName: 'users' })
export class User {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'string', length: 255, unique: true })
  public email!: string;

  // 密码只保存不可逆哈希，且不会被序列化到 API 响应中。
  @Property({
    type: 'string',
    fieldName: 'password_hash',
    length: 255,
    hidden: true,
  })
  public passwordHash!: string;

  @Property({ type: 'string', fieldName: 'display_name', length: 100 })
  public displayName!: string;

  @Enum({ items: () => UserRole, default: UserRole.USER })
  public role: UserRole = UserRole.USER;

  @Enum({ items: () => UserStatus, default: UserStatus.ACTIVE })
  public status: UserStatus = UserStatus.ACTIVE;

  @Property({
    type: 'timestamptz',
    fieldName: 'created_at',
    onCreate: () => new Date(),
  })
  public createdAt: Date = new Date();

  @Property({
    type: 'timestamptz',
    fieldName: 'updated_at',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  public updatedAt: Date = new Date();
}
