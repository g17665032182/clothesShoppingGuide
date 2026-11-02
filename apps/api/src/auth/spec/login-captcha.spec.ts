import 'reflect-metadata';

import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

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

test('登录 schema 要求带上完整验证码凭据', () => {
  const result = loginSchema.safeParse({
    email: 'user@example.com',
    password: 'ChangeMe123!',
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(
      result.error.issues.some(
        (issue) => issue.path[0] === 'captchaChallengeId',
      ),
    );
    assert.ok(
      result.error.issues.some((issue) => issue.path[0] === 'captchaAnswer'),
    );
  }
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
