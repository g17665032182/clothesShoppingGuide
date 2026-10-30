import { randomUUID } from 'node:crypto';

import {
  Entity,
  ManyToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

import { User } from '../../users/entity/user.entity.js';

@Entity({ tableName: 'refresh_sessions' })
export class RefreshSession {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @ManyToOne(() => User, {
    fieldName: 'user_id',
    deleteRule: 'cascade',
  })
  public user!: User;

  @Property({
    type: 'string',
    fieldName: 'token_hash',
    length: 64,
    unique: true,
  })
  public tokenHash!: string;

  @Property({ type: 'timestamptz', fieldName: 'expires_at' })
  public expiresAt!: Date;

  @Property({
    type: 'timestamptz',
    fieldName: 'created_at',
    onCreate: () => new Date(),
  })
  public createdAt: Date = new Date();
}
