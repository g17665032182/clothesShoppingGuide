import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityManager } from '@mikro-orm/postgresql';
import { EntityRepository } from '@mikro-orm/postgresql';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';

import type { LoginInput } from '../dto/login.dto.js';
import { CaptchaService } from '../captcha/service/captcha.service.js';
import type { RegisterInput } from '../dto/register.dto.js';
import { RefreshSession } from '../entity/refresh-session.entity.js';
import { User, UserRole, UserStatus } from '../../users/entity/user.entity.js';
import { UsersService } from '../../users/service/users.service.js';
import type { UserResponse } from '../../users/service/users.service.js';
import type { AuthSession } from '../dto/refresh-session.dto.js';

@Injectable()
export class AuthService {
  public constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly em: EntityManager,
    private readonly usersService: UsersService,
    private readonly captchaService: CaptchaService,
    @InjectRepository(User)
    private readonly users: EntityRepository<User>,
    @InjectRepository(RefreshSession)
    private readonly sessions: EntityRepository<RefreshSession>,
  ) {}

  public async register(dto: RegisterInput): Promise<AuthSession> {
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
    return this.createAuthSession(user);
  }

  public async login(dto: LoginInput): Promise<AuthSession> {
    const captchaValid = await this.captchaService.verifyLoginAnswer(
      dto.captchaChallengeId,
      dto.captchaAnswer,
    );
    if (!captchaValid) {
      throw new BadRequestException('验证码错误或已失效，请刷新后重试');
    }

    const user = await this.usersService.findByEmail(dto.email);
    if (
      !user ||
      user.status !== UserStatus.ACTIVE ||
      !(await compare(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('邮箱或密码错误');
    }
    return this.createAuthSession(user);
  }

  public async getCurrentUser(user: User): Promise<UserResponse> {
    return this.usersService.toResponse(user);
  }

  public async refresh(refreshToken: string): Promise<AuthSession> {
    const tokenHash = this.hashToken(refreshToken);
    return this.em.transactional(async (em) => {
      const session = await em.findOne(RefreshSession, { tokenHash });
      if (!session || session.expiresAt <= new Date()) {
        if (session) {
          em.remove(session);
          await em.flush();
        }
        throw new UnauthorizedException('Refresh Token 无效或已过期');
      }

      const user = await em.findOne(User, {
        id: session.user.id,
        status: UserStatus.ACTIVE,
      });
      if (!user) {
        em.remove(session);
        await em.flush();
        throw new UnauthorizedException('用户不存在或已被禁用');
      }

      em.remove(session);
      await em.flush();
      return this.createAuthSession(user, em);
    });
  }

  public async revoke(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.sessions.nativeDelete({
      tokenHash: this.hashToken(refreshToken),
    });
  }

  private async createAuthSession(
    user: User,
    em = this.em,
  ): Promise<AuthSession> {
    // Token 只携带定位用户所需的最小声明，敏感字段不会进入 JWT。
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    const refreshToken = randomBytes(48).toString('base64url');
    const lifetimeSeconds = Number(
      this.config.get('REFRESH_TOKEN_EXPIRES_IN', 2_592_000),
    );
    const session = em.create(RefreshSession, {
      user,
      tokenHash: this.hashToken(refreshToken),
      expiresAt: new Date(Date.now() + lifetimeSeconds * 1000),
      createdAt: new Date(),
    });
    em.persist(session);
    await em.flush();
    return {
      response: {
        accessToken,
        user: this.usersService.toResponse(user),
      },
      refreshToken,
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
