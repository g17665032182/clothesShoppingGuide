import type { ConfigService } from '@nestjs/config';
import type { StructuredToolInterface } from '@langchain/core/tools';

import { createLocalEchoTool } from './local-echo.tool.js';

type ToolFactory = () => StructuredToolInterface;

/**
 * 本地工具注册表。新增本地工具时只需要在这里追加工厂函数。
 */
const localToolFactories: ToolFactory[] = [createLocalEchoTool];

/**
 * 联网工具注册表。联网工具必须显式注册，并受独立开关控制。
 */
const remoteToolFactories: ToolFactory[] = [];

export function createConfiguredTools(
  config: Pick<ConfigService, 'get'>,
): StructuredToolInterface[] {
  const factories = [
    ...(config.get<string>('LLM_ENABLE_LOCAL_TEST_TOOL') === 'true'
      ? localToolFactories
      : []),
    ...(config.get<string>('LLM_ENABLE_REMOTE_TOOLS') === 'true'
      ? remoteToolFactories
      : []),
  ];
  const tools = factories.map((factory) => factory());
  const names = new Set<string>();
  for (const current of tools) {
    if (names.has(current.name)) {
      throw new Error(`LLM 工具名称重复：${current.name}`);
    }
    names.add(current.name);
  }
  return tools;
}
