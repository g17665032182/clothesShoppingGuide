import 'reflect-metadata';

import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException, UnauthorizedException } from '@nestjs/common';

import { CaptchaService } from '../captcha/service/captcha.service.js';
import { loginSchema } from '../dto/login.dto.js';
import { registerSchema } from '../dto/register.dto.js';
import { AuthService } from '../service/auth.service.js';

test('注册和登录 schema 校验字段范围并拒绝未知字段', () => {
  assert.equal(
    registerSchema.safeParse({
      email: 'user@example.com',
      password: 'ChangeMe123!',
      displayName: '春日衣橱',
    }).success,
    true,
  );
  assert.equal(
    registerSchema.safeParse({
      email: 'user@example.com',
      password: 'ChangeMe123!',
      displayName: '春日衣橱',
      role: 'admin',
    }).success,
    false,
  );
  assert.equal(
    loginSchema.safeParse({
      email: 'invalid',
      password: 'ChangeMe123!',
      captchaChallengeId: 'challenge',
      captchaAnswer: 'abc',
    }).success,
    false,
  );
});

test('登录 schema 允许验证码字段省略，必填策略由服务端环境控制', () => {
  const result = loginSchema.safeParse({
    email: 'user@example.com',
    password: 'ChangeMe123!',
  });

  assert.equal(result.success, true);
});

test('验证码无效时不会查询账户或继续认证', async () => {
  let accountLookupCount = 0;
  const usersService = {
    findByEmail: async () => {
      accountLookupCount += 1;
      return null;
    },
  } as never;
  const captchaService = {
    isEnabled: () => true,
    verifyLoginAnswer: async () => false,
  } as unknown as CaptchaService;
  const service = new AuthService(
    {} as never,
    {} as never,
    {} as never,
    usersService,
    captchaService,
    {} as never,
    {} as never,
  );

  await assert.rejects(
    service.login({
      email: 'user@example.com',
      password: 'ChangeMe123!',
      captchaChallengeId: 'challenge-id',
      captchaAnswer: 'wrong',
    }),
    (error: unknown) =>
      error instanceof BadRequestException && error.getStatus() === 400,
  );
  assert.equal(accountLookupCount, 0);
});

test('启用验证码的环境缺少验证码时不会查询账户', async () => {
  let accountLookupCount = 0;
  const service = new AuthService(
    {} as never,
    {} as never,
    {} as never,
    {
      findByEmail: async () => {
        accountLookupCount += 1;
        return null;
      },
    } as never,
    { isEnabled: () => true } as never,
    {} as never,
    {} as never,
  );

  await assert.rejects(
    service.login({ email: 'user@example.com', password: 'ChangeMe123!' }),
    (error: unknown) =>
      error instanceof BadRequestException && error.getStatus() === 400,
  );
  assert.equal(accountLookupCount, 0);
});

test('开发环境跳过验证码校验并继续执行邮箱密码认证', async () => {
  let accountLookupCount = 0;
  let captchaVerificationCount = 0;
  const service = new AuthService(
    {} as never,
    {} as never,
    {} as never,
    {
      findByEmail: async () => {
        accountLookupCount += 1;
        return null;
      },
    } as never,
    {
      isEnabled: () => false,
      verifyLoginAnswer: async () => {
        captchaVerificationCount += 1;
        return false;
      },
    } as never,
    {} as never,
    {} as never,
  );

  await assert.rejects(
    service.login({ email: 'user@example.com', password: 'ChangeMe123!' }),
    (error: unknown) =>
      error instanceof UnauthorizedException && error.getStatus() === 401,
  );
  assert.equal(accountLookupCount, 1);
  assert.equal(captchaVerificationCount, 0);
});
