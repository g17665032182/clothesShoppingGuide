import {
  Body,
  Controller,
  HttpException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { CurrentUser } from '../../auth/decorator/current-user.decorator.js';
import { ChatDto, chatSchema } from '../../llm/dto/chat.dto.js';
import type { User } from '../../users/entity/user.entity.js';
import {
  ChatRecordsService,
  type PersistedChatOutput,
} from '../service/chat-records.service.js';

@Controller('llm')
@ApiBearerAuth('bearer')
@ApiTags('大模型聊天')
export class LlmChatController {
  public constructor(private readonly chatRecords: ChatRecordsService) {}

  @Post('chat')
  public chat(
    @CurrentUser() user: User,
    @Body({ schema: chatSchema }) body: ChatDto,
  ): Promise<PersistedChatOutput> {
    return this.chatRecords.chat(user, body);
  }

  @Post('chat/stream')
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description:
      'SSE 事件流：start（含上下文窗口）、delta、activity、sources、done（含最终调用用量）；事务提交后发送 done，响应开始后的失败通过 error 事件返回。',
    content: {
      'text/event-stream': {
        schema: { type: 'string' },
        example: 'event: delta\\ndata: {"content":"你好"}\\n\\n',
      },
    },
  })
  @ApiBadGatewayResponse({ description: '上游大模型调用失败' })
  @ApiServiceUnavailableResponse({ description: '大模型服务尚未完成配置' })
  public async stream(
    @CurrentUser() user: User,
    @Body({ schema: chatSchema }) body: ChatDto,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    const abortController = new AbortController();
    const abortRequest = () => abortController.abort();
    const abortIfDisconnected = () => {
      if (!response.writableEnded) {
        abortController.abort();
      }
    };
    request.once('aborted', abortRequest);
    response.once('close', abortIfDisconnected);

    try {
      // 必须先完成归属与上下文预校验，保证可预知错误仍能返回 HTTP 状态。
      const events = await this.chatRecords.prepareStream(
        user,
        body,
        abortController.signal,
      );
      if (abortController.signal.aborted || response.destroyed) return;

      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      response.setHeader('Cache-Control', 'no-cache, no-transform');
      response.setHeader('X-Accel-Buffering', 'no');
      response.flushHeaders();

      for await (const event of events) {
        if (abortController.signal.aborted || response.destroyed) return;
        const { type, ...payload } = event;
        const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
        if (!response.write(frame)) {
          await once(response, 'drain', { signal: abortController.signal });
        }
      }
      if (!response.writableEnded && !response.destroyed) response.end();
    } catch (error) {
      if (
        abortController.signal.aborted ||
        response.destroyed ||
        response.writableEnded
      ) {
        return;
      }

      if (!response.headersSent) {
        throw error;
      }

      const message =
        error instanceof HttpException
          ? this.publicMessage(error)
          : '聊天生成失败或记录保存失败，请刷新会话确认状态';
      response.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
      response.end();
    } finally {
      request.off('aborted', abortRequest);
      response.off('close', abortIfDisconnected);
    }
  }

  private publicMessage(error: HttpException): string {
    const response = error.getResponse();
    if (
      typeof response === 'object' &&
      response !== null &&
      'message' in response &&
      typeof response.message === 'string'
    ) {
      return response.message;
    }
    return '聊天生成失败或记录保存失败';
  }
}
