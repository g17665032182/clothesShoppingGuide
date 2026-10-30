import {
  CheckConstraintViolationException,
  ConnectionException,
  DeadlockException,
  DriverException,
  ForeignKeyConstraintViolationException,
  LockWaitTimeoutException,
  NotNullConstraintViolationException,
  RowLevelSecurityViolationException,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';
import { Catch, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

type HttpRequest = {
  method: string;
  url?: string;
  originalUrl?: string;
};

type HttpResponse = {
  status(statusCode: number): HttpResponse;
  json(body: unknown): void;
};

type DbErrorResponse = {
  status: number;
  message: string;
};

// 数据库异常到 HTTP 响应的映射规则。
const DB_HTTP_RULES: Array<{
  matches: (exception: DriverException) => boolean;
  response: DbErrorResponse;
}> = [
  {
    matches: (exception) =>
      exception instanceof UniqueConstraintViolationException,
    response: {
      status: HttpStatus.CONFLICT,
      message: '数据已存在',
    },
  },
  {
    matches: (exception) =>
      exception instanceof ForeignKeyConstraintViolationException,
    response: {
      status: HttpStatus.CONFLICT,
      message: '关联数据不存在或仍被引用',
    },
  },
  {
    matches: (exception) =>
      exception instanceof NotNullConstraintViolationException ||
      exception instanceof CheckConstraintViolationException,
    response: {
      status: HttpStatus.BAD_REQUEST,
      message: '数据不符合约束',
    },
  },
  {
    matches: (exception) =>
      exception instanceof RowLevelSecurityViolationException,
    response: {
      status: HttpStatus.FORBIDDEN,
      message: '没有权限操作数据',
    },
  },
  {
    matches: (exception) =>
      exception instanceof ConnectionException ||
      exception instanceof DeadlockException ||
      exception instanceof LockWaitTimeoutException,
    response: {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: '数据库服务暂不可用',
    },
  },
];

function resolveDbErrorResponse(exception: DriverException): DbErrorResponse {
  return (
    DB_HTTP_RULES.find((rule) => rule.matches(exception))?.response ?? {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: '数据库操作失败',
    }
  );
}

@Catch(DriverException)
export class DbExceptionFilter implements ExceptionFilter {
  public constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(DbExceptionFilter.name);
  }

  public catch(exception: DriverException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    const request = host.switchToHttp().getRequest<HttpRequest>();
    const { status, message } = resolveDbErrorResponse(exception);

    // 只记录诊断所需的安全字段，避免把 SQL 和底层错误文本返回或写入日志。
    this.logger.error(
      {
        databaseError: {
          name: exception.name,
          code: exception.code,
          sqlState: exception.sqlState,
        },
        request: {
          method: request.method,
          url: request.originalUrl ?? request.url,
        },
      },
      '数据库异常已转换为 HTTP 响应',
    );

    response.status(status).json({
      statusCode: status,
      message,
    });
  }
}
