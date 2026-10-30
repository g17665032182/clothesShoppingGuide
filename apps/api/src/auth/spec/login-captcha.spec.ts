import 'reflect-metadata';

import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CaptchaService } from '../captcha/service/captcha.service.js';
import { LoginDto } from '../dto/login.dto.js';
import { AuthService } from '../service/auth.service.js';

test('LoginDto 要求带上完整验证码凭据', async () => {
  const dto = plainToInstance(LoginDto, {
    email: 'user@example.com',
    password: 'ChangeMe123!',
  });
  const errors = await validate(dto);

  assert.ok(errors.some((error) => error.property === 'captchaChallengeId'));
  assert.ok(errors.some((error) => error.property === 'captchaAnswer'));
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
