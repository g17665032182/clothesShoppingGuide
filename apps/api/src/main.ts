/*
 * @Date: 2026-10-26 22:33:47
 * @LastEditors: shiyu 625991037@qq.com
 * @LastEditTime: 2026-10-27 16:27:33
 * @FilePath: /clothesShoppingGuide/apps/api/src/main.ts
 * @Description:
 */
import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  // 先缓存启动日志，待 Pino 完成初始化后统一接管 Nest 日志。
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // 全局开启 DTO 校验，拒绝未知字段并自动转换常见请求参数。
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // 启用隐式类型转换，允许将请求参数自动转换为 DTO 中定义的类型。
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  app.setGlobalPrefix('api');
  app.enableCors();
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

await bootstrap();
