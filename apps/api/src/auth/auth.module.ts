import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { APP_GUARD } from '@nestjs/core';

import { User } from '../users/entity/user.entity.js';
import { UsersModule } from '../users/users.module.js';
import { RolesGuard } from '../authorization/guard/roles.guard.js';
import { AuthController } from './controller/auth.controller.js';
import { CaptchaModule } from './captcha/captcha.module.js';
import { RefreshSession } from './entity/refresh-session.entity.js';
import { AuthService } from './service/auth.service.js';
import { JwtAuthGuard } from './guard/jwt-auth.guard.js';

@Module({
  imports: [
    ConfigModule,
    CaptchaModule,
    UsersModule,
    MikroOrmModule.forFeature([User, RefreshSession]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        global: true,
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: Number(config.get('JWT_EXPIRES_IN', 900)),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    RolesGuard,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
