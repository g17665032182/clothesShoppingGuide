import assert from 'node:assert/strict';
import test from 'node:test';

import { ChatRecordsService } from './chat-records.service.js';
import { PaginationDto } from './dto/pagination.dto.js';

test('标题生成会压缩空白并按 Unicode 字符截断', () => {
  const service = Object.create(
    ChatRecordsService.prototype,
  ) as ChatRecordsService;

  assert.equal(
    service.generateConversationTitle('  春夏   穿搭\n推荐  '),
    '春夏 穿搭 推荐',
  );
  assert.equal(
    service.generateConversationTitle('😀'.repeat(31)),
    `${'😀'.repeat(30)}...`,
  );
});

test('分页 DTO 缺省值和非法运行时值会回退到安全范围', () => {
  const pagination = Object.assign(new PaginationDto(), {
    page: undefined,
    pageSize: undefined,
  }) as unknown as PaginationDto;

  assert.equal(pagination.normalizedPage, 1);
  assert.equal(pagination.normalizedPageSize, 20);
  assert.equal(pagination.offset, 0);
});
