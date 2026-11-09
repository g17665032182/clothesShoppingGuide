import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { AuthService } from '../service/auth.service.js';
import { CurrentUser } from '../decorator/current-user.decorator.js';
import { Public } from '../decorator/public.decorator.js';
import { LoginDto, loginSchema } from '../dto/login.dto.js';
import { RegisterDto, registerSchema } from '../dto/register.dto.js';
import { CaptchaService } from '../captcha/service/captcha.service.js';
import { CaptchaResponseDto } from '../captcha/dto/captcha-response.dto.js';
import { AuthConfigDto } from '../dto/auth-config.dto.js';
import { User } from '../../users/entity/user.entity.js';

@Controller('auth')
@ApiTags('认证')
export class AuthController {
  public constructor(
    private readonly authService: AuthService,
    private readonly captchaService: CaptchaService,
  ) {}

  private readonly refreshCookieName = 'clothes-guide.refresh-token';

  @Public()
  @Get('config')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '获取公开认证配置' })
  @ApiOkResponse({ type: AuthConfigDto })
  public getConfig(): AuthConfigDto {
    return { captchaEnabled: this.captchaService.isEnabled() };
  }

  @Public()
  @Get('captcha')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '获取登录图片验证码' })
  @ApiOkResponse({ type: CaptchaResponseDto })
  public getCaptcha(): Promise<CaptchaResponseDto> {
    return this.captchaService.issueLoginChallenge();
  }

  @Public()
  @Post('register')
  public async register(
    @Body({ schema: registerSchema }) dto: RegisterDto,
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
    @Body({ schema: loginSchema }) dto: LoginDto,
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
