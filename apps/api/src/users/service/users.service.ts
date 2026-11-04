import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import { hash } from 'bcryptjs';

import type { AdminUpdateUserInput } from '../dto/admin-update-user.dto.js';
import type { UpdateProfileInput } from '../dto/update-profile.dto.js';
import { User, UserStatus } from '../entity/user.entity.js';

export type UserResponse = {
  id: string;
  email: string;
  displayName: string;
  role: User['role'];
  status: User['status'];
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class UsersService {
  public constructor(
    @InjectRepository(User)
    private readonly users: EntityRepository<User>,
  ) {}

  public async findById(id: string): Promise<User | null> {
    return this.users.findOne({ id });
  }

  public async findActiveById(id: string): Promise<User | null> {
    return this.users.findOne({ id, status: UserStatus.ACTIVE });
  }

  public async isActive(id: string): Promise<boolean> {
    // 后台读取使用独立工作单元，公开调用方无需接触用户实体。
    const entityManager = this.users.getEntityManager().fork();
    return (
      (await entityManager.count(User, { id, status: UserStatus.ACTIVE })) > 0
    );
  }

  public async findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ email: this.normalizeEmail(email) });
  }

  public async list(): Promise<UserResponse[]> {
    const users = await this.users.findAll({
      orderBy: { createdAt: 'desc' },
    });
    return users.map((user) => this.toResponse(user));
  }

  public async getRequired(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return user;
  }

  public async updateProfile(
    user: User,
    dto: UpdateProfileInput,
  ): Promise<UserResponse> {
    if (dto.displayName !== undefined) {
      const displayName = dto.displayName.trim();
      if (!displayName) {
        throw new BadRequestException('昵称不能为空');
      }
      user.displayName = displayName;
    }
    if (dto.password !== undefined) {
      user.passwordHash = await hash(dto.password, 12);
    }
    await this.users.getEntityManager().flush();
    return this.toResponse(user);
  }

  public async updateByAdmin(
    id: string,
    dto: AdminUpdateUserInput,
  ): Promise<UserResponse> {
    const user = await this.getRequired(id);
    if (dto.displayName !== undefined) {
      const displayName = dto.displayName.trim();
      if (!displayName) {
        throw new BadRequestException('昵称不能为空');
      }
      user.displayName = displayName;
    }
    if (dto.role !== undefined) {
      user.role = dto.role;
    }
    if (dto.status !== undefined) {
      user.status = dto.status;
    }
    await this.users.getEntityManager().flush();
    return this.toResponse(user);
  }

  public async disable(id: string): Promise<UserResponse> {
    const user = await this.getRequired(id);
    user.status = UserStatus.DISABLED;
    await this.users.getEntityManager().flush();
    return this.toResponse(user);
  }

  public toResponse(user: User): UserResponse {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  public normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  public async assertEmailAvailable(email: string): Promise<void> {
    const existing = await this.findByEmail(email);
    if (existing) {
      throw new ConflictException('邮箱已注册');
    }
  }
}
