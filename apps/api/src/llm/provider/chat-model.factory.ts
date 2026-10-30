import { ServiceUnavailableException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';

export type LlmConfig = {
  provider: 'openai-compatible';
  apiKey: string;
  baseUrl?: string;
  model: string;
  temperature: number;
  timeoutMs: number;
};

/**
 * 读取服务端 LLM 配置并创建供应商无关的 Chat Model。
 * 配置只在模块初始化时解析，避免请求参数覆盖服务端策略。
 */
@Injectable()
export class ChatModelFactory {
  public constructor(private readonly configService: ConfigService) {}

  public create(): BaseChatModel {
    const config = this.readConfig();
    const configuration = config.baseUrl
      ? { baseURL: config.baseUrl }
      : undefined;

    return new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      temperature: config.temperature,
      timeout: config.timeoutMs,
      maxRetries: 0,
      ...(configuration ? { configuration } : {}),
    });
  }

  private readConfig(): LlmConfig {
    const provider = this.readString('LLM_PROVIDER') ?? 'openai-compatible';
    if (provider !== 'openai-compatible') {
      throw new ServiceUnavailableException('LLM_PROVIDER 配置不受支持');
    }

    const apiKey = this.readString('LLM_API_KEY');
    const model = this.readString('LLM_MODEL');
    if (!apiKey || !model) {
      throw new ServiceUnavailableException('LLM 服务配置不完整');
    }

    const temperature = this.readNumber('LLM_TEMPERATURE', 0.7);
    if (temperature < 0 || temperature > 2) {
      throw new ServiceUnavailableException('LLM_TEMPERATURE 配置无效');
    }

    const timeoutMs = this.readNumber('LLM_TIMEOUT_MS', 30_000);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new ServiceUnavailableException('LLM_TIMEOUT_MS 配置无效');
    }

    const baseUrl = this.readString('LLM_BASE_URL');

    return {
      provider,
      apiKey,
      model,
      temperature,
      timeoutMs,
      ...(baseUrl ? { baseUrl } : {}),
    };
  }

  private readString(key: string): string | undefined {
    const value = this.configService.get<string>(key);
    const normalized = value?.trim();
    return normalized || undefined;
  }

  private readNumber(key: string, fallback: number): number {
    const rawValue = this.readString(key);
    if (!rawValue) {
      return fallback;
    }

    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      throw new ServiceUnavailableException(`${key} 配置无效`);
    }
    return value;
  }
}
