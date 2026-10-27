import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';

import { AuthService } from './auth.service.js';
import { CurrentUser } from './decorator/current-user.decorator.js';
import { Public } from './decorator/public.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { User } from '../users/user.entity.js';

@Controller('auth')
export class AuthController {
  public constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  public register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  public login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  public me(@CurrentUser() user: User) {
    return this.authService.getCurrentUser(user);
  }
}
