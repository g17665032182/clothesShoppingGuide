import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { User } from '../users/user.entity.js';
import { UserRole } from '../users/user.entity.js';
import { ROLES_KEY } from './roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  public constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) {
      return true;
    }

    // 角色校验依赖 JWT Guard 注入的当前用户，避免从客户端直接信任角色字段。
    const user = context.switchToHttp().getRequest<{ user?: User }>().user;
    if (user && roles.includes(user.role)) {
      return true;
    }
    throw new ForbiddenException('没有执行此操作的权限');
  }
}
