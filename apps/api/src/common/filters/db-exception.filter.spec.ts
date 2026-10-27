import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConnectionException,
  DriverException,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';
import type { ArgumentsHost } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { DbExceptionFilter } from './db-exception.filter.js';

function createHost(): {
  host: ArgumentsHost;
  response: { statusCode?: number; body?: unknown };
} {
  const result: { statusCode?: number; body?: unknown } = {};
  const response = {
    status(statusCode: number) {
      result.statusCode = statusCode;
      return this;
    },
    json(body: unknown) {
      result.body = body;
      return this;
    },
  };
  const request = {
    method: 'POST',
    originalUrl: '/api/auth/register',
    url: '/api/auth/register',
  };
  const host = {
    switchToHttp() {
      return {
        getResponse: () => response,
        getRequest: () => request,
      };
    },
  } as unknown as ArgumentsHost;
  return { host, response: result };
}

function createFilter(): {
  filter: DbExceptionFilter;
  logs: unknown[];
} {
  const logs: unknown[] = [];
  const logger = {
    setContext() {},
    error(payload: unknown) {
      logs.push(payload);
    },
  } as unknown as PinoLogger;
  return {
    filter: new DbExceptionFilter(logger),
    logs,
  };
}

test('唯一约束异常转换为 409 且不返回底层错误文本', () => {
  const { filter, logs } = createFilter();
  const { host, response } = createHost();
  const exception = Object.assign(
    new UniqueConstraintViolationException(
      new Error('duplicate key contains secret database detail'),
    ),
    {
      code: '23505',
      sqlState: '23505',
    },
  );

  filter.catch(exception, host);

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, {
    statusCode: 409,
    message: '数据已存在',
  });
  assert.equal(JSON.stringify(response.body).includes('secret'), false);
  assert.equal(logs.length, 1);
  assert.equal(JSON.stringify(logs[0]).includes('secret'), false);
});

test('未细分的数据库异常转换为 500', () => {
  const { filter } = createFilter();
  const { host, response } = createHost();

  filter.catch(new DriverException(new Error('driver failure')), host);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    statusCode: 500,
    message: '数据库操作失败',
  });
});

test('连接异常转换为 503', () => {
  const { filter } = createFilter();
  const { host, response } = createHost();

  filter.catch(new ConnectionException(new Error('connection failure')), host);

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    statusCode: 503,
    message: '数据库服务暂不可用',
  });
});
