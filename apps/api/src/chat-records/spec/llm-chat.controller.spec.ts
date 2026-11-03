import 'reflect-metadata';

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

import {
  Module,
  NotFoundException,
  ServiceUnavailableException,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { ChatMessageRole, type ChatDto } from '../../llm/dto/chat.dto.js';
import type { User } from '../../users/entity/user.entity.js';
import { LlmChatController } from '../controller/llm-chat.controller.js';
import {
  ChatRecordsService,
  type ChatStreamEvent,
} from '../service/chat-records.service.js';

const user = { id: '6b290798-e1d4-421a-9ba1-d1a4b68335f7' } as User;
const body: ChatDto = {
  messages: [{ role: ChatMessageRole.USER, content: '推荐通勤服装' }],
};
const context = {
  contextWindowTokens: 64000,
  inputTokens: 10,
  outputTokens: 5,
  usedTokens: 15,
};
const start: ChatStreamEvent = {
  type: 'start',
  conversationId: '88c78178-a3e6-441b-b787-87c1f8ac771d',
  title: '通勤服装',
  contextWindowTokens: 64000,
};
const events: ChatStreamEvent[] = [
  start,
  {
    type: 'activity',
    activity: {
      type: 'tool',
      id: 'tool-1',
      toolName: 'get_current_time',
      status: 'success',
      input: {},
      output: '2026-11-03',
    },
  },
  {
    type: 'sources',
    sources: [
      { id: 'source-1', title: '服装资料', url: 'https://example.com' },
    ],
  },
  { type: 'delta', content: '适合通勤的衬衫。\n下一行' },
  {
    type: 'done',
    conversationId: start.conversationId,
    title: start.title,
    model: 'fake-model',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    context,
  },
];

type FakeChatRecords = Pick<ChatRecordsService, 'prepareStream'>;

@Module({})
class ChatSseTestModule {}

async function serve(fake: FakeChatRecords) {
  // tsx 不生成构造器元数据，测试显式补齐 Nest 的依赖声明。
  Reflect.defineMetadata(
    'design:paramtypes',
    [ChatRecordsService],
    LlmChatController,
  );
  const app = await NestFactory.create(
    {
      module: ChatSseTestModule,
      controllers: [LlmChatController],
      providers: [{ provide: ChatRecordsService, useValue: fake }],
    },
    { logger: false },
  );
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.setGlobalPrefix('api');
  app.use(
    (
      request: IncomingMessage & { user: User },
      _response: ServerResponse,
      next: () => void,
    ) => {
      request.user = user;
      next();
    },
  );
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  return {
    async close() {
      (app.getHttpServer() as Server).closeAllConnections();
      await app.close();
    },
    url: `http://127.0.0.1:${address.port}/api/llm/chat/stream`,
  };
}

function post(url: string, value: unknown = body, signal?: AbortSignal) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Connection: 'close' },
    body: JSON.stringify(value),
    ...(signal ? { signal } : {}),
  });
}

function parseFrames(text: string) {
  return text
    .trim()
    .split('\n\n')
    .map((frame) => {
      const [event, data] = frame.split('\n');
      return {
        type: event!.slice('event: '.length),
        ...JSON.parse(data!.slice('data: '.length)),
      };
    });
}

test('HTTP SSE 序列化全部公开事件并且只发送一次 done', async (t) => {
  const received: unknown[] = [];
  const { close, url } = await serve({
    async prepareStream(currentUser, dto) {
      received.push({ currentUser, dto });
      return (async function* () {
        yield* events;
      })();
    },
  });
  t.after(close);

  const response = await post(url);
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get('content-type') ?? '',
    /text\/event-stream/,
  );
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  const frames = parseFrames(await response.text());
  assert.deepEqual(frames, events);
  assert.equal(frames.filter((frame) => frame.type === 'done').length, 1);
  assert.deepEqual(received, [{ currentUser: user, dto: body }]);
});

test('响应头发送前保留参数400、归属404和配置503状态', async (t) => {
  let calls = 0;
  const { close, url } = await serve({
    async prepareStream(_currentUser, dto) {
      calls += 1;
      if (dto.messages[0]?.content === 'missing') {
        throw new NotFoundException('会话不存在');
      }
      throw new ServiceUnavailableException('大模型服务尚未完成配置');
    },
  });
  t.after(close);

  const invalid = await post(url, { ...body, unexpected: true });
  assert.equal(invalid.status, 400);
  assert.equal(calls, 0);
  await invalid.text();
  for (const [content, status] of [
    ['missing', 404],
    ['unconfigured', 503],
  ] as const) {
    const response = await post(url, {
      messages: [{ role: 'user', content }],
    });
    assert.equal(response.status, status);
    assert.doesNotMatch(
      response.headers.get('content-type') ?? '',
      /text\/event-stream/,
    );
    assert.equal(JSON.parse(await response.text()).statusCode, status);
  }
});

test('发送响应头后的异常转换为 error 帧，不发送 done 或泄露上游错误', async (t) => {
  const { close, url } = await serve({
    async prepareStream() {
      return (async function* () {
        yield start;
        throw new Error('secret sk-test upstream failure');
      })();
    },
  });
  t.after(close);
  const response = await post(url);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.deepEqual(
    parseFrames(text).map((frame) => frame.type),
    ['start', 'error'],
  );
  assert.doesNotMatch(text, /sk-test|upstream/);
});

test(
  '真实 HTTP 客户端断开会取消信号并关闭业务生成器',
  { timeout: 5000 },
  async (t) => {
    let finish!: () => void;
    const closed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let requestSignal: AbortSignal | undefined;
    const { close, url } = await serve({
      async prepareStream(_currentUser, _dto, signal) {
        requestSignal = signal;
        return (async function* () {
          try {
            yield start;
            if (!signal?.aborted) {
              await new Promise<void>((resolve) => {
                signal?.addEventListener('abort', () => resolve(), {
                  once: true,
                });
              });
            }
          } finally {
            finish();
          }
        })();
      },
    });
    t.after(close);
    const controller = new AbortController();
    const response = await post(url, body, controller.signal);
    const reader = response.body!.getReader();
    assert.equal((await reader.read()).done, false);
    controller.abort();
    await reader.cancel().catch(() => undefined);
    await closed;
    assert.equal(requestSignal?.aborted, true);
  },
);

class ControlledResponse extends EventEmitter {
  public writableEnded = false;
  public destroyed = false;
  public headersSent = false;
  public statusCode = 200;
  public frames: string[] = [];
  public setHeader(): void {}
  public flushHeaders(): void {
    this.headersSent = true;
  }
  public write(frame: string): boolean {
    this.frames.push(frame);
    return this.frames.length !== 1;
  }
  public end(): void {
    this.writableEnded = true;
  }
}

test(
  '等待 drain 时暂停上游，正常结束和断开均清理监听及迭代器',
  { timeout: 5000 },
  async () => {
    for (const disconnect of [false, true]) {
      let produced = 0;
      let closed = false;
      let signal: AbortSignal | undefined;
      const fake: FakeChatRecords = {
        async prepareStream(_user, _body, currentSignal) {
          signal = currentSignal;
          return (async function* () {
            try {
              for (const event of events) {
                produced += 1;
                yield event;
              }
            } finally {
              closed = true;
            }
          })();
        },
      };
      const controller = new LlmChatController(fake as ChatRecordsService);
      const request = new EventEmitter();
      const response = new ControlledResponse();
      const operation = controller.stream(
        user,
        body,
        request as IncomingMessage,
        response as unknown as ServerResponse,
      );
      await setImmediate();
      assert.equal(produced, 1);
      if (disconnect) {
        response.destroyed = true;
        response.emit('close');
      } else {
        response.emit('drain');
      }
      await operation;
      assert.equal(closed, true);
      assert.equal(request.listenerCount('aborted'), 0);
      assert.equal(response.listenerCount('close'), 0);
      assert.equal(response.listenerCount('drain'), 0);
      assert.equal(signal?.aborted, disconnect);
      assert.equal(response.frames.length, disconnect ? 1 : events.length);
    }
  },
);
