import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import { compare, hash } from 'bcryptjs';

import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { User, UserRole, UserStatus } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import type { UserResponse } from '../users/users.service.js';

export type AuthResponse = {
  accessToken: string;
  user: UserResponse;
};

@Injectable()
export class AuthService {
  public constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    @InjectRepository(User)
    private readonly users: EntityRepository<User>,
  ) {}

  public async register(dto: RegisterDto): Promise<AuthResponse> {
    const email = this.usersService.normalizeEmail(dto.email);
    await this.usersService.assertEmailAvailable(email);
    const displayName = dto.displayName.trim();
    if (!displayName) {
      throw new BadRequestException('昵称不能为空');
    }

    const user = this.users.create({
      email,
      passwordHash: await hash(dto.password, 12),
      displayName,
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await this.users.getEntityManager().flush();
    return this.createAuthResponse(user);
  }

  public async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.usersService.findByEmail(dto.email);
    if (
      !user ||
      user.status !== UserStatus.ACTIVE ||
      !(await compare(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('邮箱或密码错误');
    }
    return this.createAuthResponse(user);
  }

  public async getCurrentUser(user: User): Promise<UserResponse> {
    return this.usersService.toResponse(user);
  }

  private async createAuthResponse(user: User): Promise<AuthResponse> {
    // Token 只携带定位用户所需的最小声明，敏感字段不会进入 JWT。
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    return {
      accessToken,
      user: this.usersService.toResponse(user),
    };
  }
}
