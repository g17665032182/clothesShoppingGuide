import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { AuthService } from './auth.service.js';
import { CurrentUser } from './decorator/current-user.decorator.js';
import { Public } from './decorator/public.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { User } from '../users/user.entity.js';

@Controller('auth')
@ApiTags('认证')
export class AuthController {
  public constructor(private readonly authService: AuthService) {}

  private readonly refreshCookieName = 'clothes-guide.refresh-token';

  @Public()
  @Post('register')
  public async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: ServerResponse,
  ) {
    const session = await this.authService.register(dto);
    this.setRefreshCookie(response, session.refreshToken);
    return session.response;
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  public async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: ServerResponse,
  ) {
    const session = await this.authService.login(dto);
    this.setRefreshCookie(response, session.refreshToken);
    return session.response;
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  public async refresh(
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ) {
    const refreshToken = this.readRefreshCookie(request);
    if (!refreshToken) {
      throw new UnauthorizedException('缺少 Refresh Token Cookie');
    }
    const session = await this.authService.refresh(refreshToken);
    this.setRefreshCookie(response, session.refreshToken);
    return session.response;
  }

  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  public async logout(
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<void> {
    await this.authService.revoke(this.readRefreshCookie(request));
    this.clearRefreshCookie(response);
  }

  @Get('me')
  @ApiBearerAuth('bearer')
  public me(@CurrentUser() user: User) {
    return this.authService.getCurrentUser(user);
  }

  private readRefreshCookie(request: IncomingMessage): string | undefined {
    const prefix = `${this.refreshCookieName}=`;
    const cookie = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix));
    if (!cookie) return undefined;
    try {
      return decodeURIComponent(cookie.slice(prefix.length));
    } catch {
      // 篡改后的 Cookie 按无效凭证处理，避免将 URI 解码异常暴露为 500。
      return undefined;
    }
  }

  private setRefreshCookie(response: ServerResponse, token: string): void {
    const maxAge = Number(process.env.REFRESH_TOKEN_EXPIRES_IN ?? 2_592_000);
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    response.setHeader(
      'Set-Cookie',
      `${this.refreshCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=${maxAge}${secure}`,
    );
  }

  private clearRefreshCookie(response: ServerResponse): void {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    response.setHeader(
      'Set-Cookie',
      `${this.refreshCookieName}=; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=0${secure}`,
    );
  }
}
