import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { IncomingHttpHeaders } from 'node:http';

import { UsersService } from '../../users/service/users.service.js';
import { IS_PUBLIC_KEY } from '../decorator/public.decorator.js';

type JwtPayload = {
  sub: string;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  public constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // 先校验签名和过期时间，再查询数据库确认账号仍处于启用状态。
    const request = context
      .switchToHttp()
      .getRequest<{ headers: IncomingHttpHeaders; user?: unknown }>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('缺少 Bearer Token');
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      const user = await this.usersService.findActiveById(payload.sub);
      if (!user) {
        throw new UnauthorizedException('用户不存在或已被禁用');
      }
      request.user = user;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Token 无效或已过期');
    }
  }

  private extractToken(request: {
    headers: IncomingHttpHeaders;
  }): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
