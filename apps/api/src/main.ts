/*
 * @Date: 2026-10-26 22:33:47
 * @LastEditors: shiyu 625991037@qq.com
 * @LastEditTime: 2026-10-27 16:27:33
 * @FilePath: /clothesShoppingGuide/apps/api/src/main.ts
 * @Description:
 */
import 'reflect-metadata';

import { StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  // 先缓存启动日志，待 Pino 完成初始化后统一接管 Nest 日志。
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(helmet());

  // 请求参数通过装饰器绑定的 Zod schema 校验并使用其转换结果。
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.setGlobalPrefix('api');
  // 前端通过 HttpOnly Cookie 携带 Refresh Token，跨源开发请求需要允许凭证。
  app.enableCors({ origin: true, credentials: true });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('服装购物指南 API')
    .setDescription('服装购物指南后端接口文档')
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      'bearer',
    )
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument, {
    useGlobalPrefix: true,
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const port = Number(process.env.PORT ?? 3000);
  // Render 容器需要监听所有网卡，才能接收平台转发的请求。
  await app.listen(port, '0.0.0.0');
}

await bootstrap();
