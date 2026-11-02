import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export function createLocalEchoTool() {
  return tool(async ({ value }) => `LOCAL_TOOL_RESULT:${value}`, {
    name: 'local_echo_tool',
    description:
      '本地链路验证工具。原样返回 value，并添加 LOCAL_TOOL_RESULT: 前缀；不访问网络或修改数据。',
    schema: z.object({
      value: z.string().min(1).max(200),
    }),
  });
}
