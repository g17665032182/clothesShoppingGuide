# 通用大模型模块技术文档

## 文档信息

- 关联设计文档：[通用大模型模块设计](./llm-module-design.md)
- 状态：待实现
- 所属应用：`apps/api`
- 技术栈：NestJS、LangChain.js、LangGraph.js、TypeScript
- 最后更新：2026-10-27

## 实现目标

在 `apps/api` 中实现一个独立的 `LlmModule`，完成一次无状态文本对话调用：

```text
HTTP 请求
  -> Controller
  -> LlmService
  -> LangGraph
  -> LangChain Chat Model
  -> 供应商 API
  -> 标准化响应
```

模块不保存对话、不访问业务 Entity，不创建数据库表，也不依赖商品或其他领域模块。

## 依赖方案

实现时向 `apps/api` 增加以下依赖：

```text
@langchain/core
@langchain/langgraph
@langchain/openai
zod
```

`@langchain/openai` 只作为当前 OpenAI 兼容 Chat Model 的实现。若最终供应商使用其他官方 LangChain 集成包，只替换 Provider 工厂，不改变 `LlmService` 和 Graph 的接口。

建议通过 Workspace 中的 pnpm 命令添加依赖，并使用安装时解析出的兼容版本，不在技术文档中写死未经验证的版本号：

```bash
pnpm --filter @clothes-shopping-guide/api add \
  @langchain/core @langchain/langgraph @langchain/openai zod
```

安装后必须执行：

```bash
pnpm check
```

## 目录和依赖关系

```text
apps/api/src/llm/
  llm.module.ts
  llm.controller.ts
  llm.service.ts
  llm.graph.ts
  llm.state.ts
  llm.tokens.ts
  dto/
    chat.dto.ts
  providers/
    chat-model.factory.ts
```

依赖方向固定为：

```text
llm.controller.ts
  -> llm.service.ts
      -> llm.tokens.ts
      -> compiled graph
          -> ChatModel
```

Controller 不得直接导入 `ChatOpenAI`，业务模块不得导入 `providers/` 下的具体实现。

## 配置实现

### 环境变量

在 `apps/api/.env.example` 中增加：

```env
LLM_PROVIDER=openai-compatible
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=
LLM_TEMPERATURE=0.7
LLM_TIMEOUT_MS=30000
```

### 配置解析

使用现有的全局 `ConfigModule` 和 `ConfigService`。Provider 工厂负责：

1. 读取配置。
2. 检查 `LLM_API_KEY` 和 `LLM_MODEL`。
3. 将温度和超时转换为数字。
4. 创建 LangChain Chat Model。
5. 保证密钥不进入日志、异常响应和业务返回值。

技术实现可以定义一个内部配置类型：

```ts
type LlmConfig = {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  model: string;
  temperature: number;
  timeoutMs: number;
};
```

`LLM_BASE_URL` 为空时不传入覆盖地址，让供应商 SDK 使用默认地址。

## Provider 工厂

`providers/chat-model.factory.ts` 负责创建 LangChain 的标准 Chat Model。工厂的返回类型使用 LangChain 的 Chat Model 抽象，而不是 `ChatOpenAI` 具体类型：

```ts
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

export type ChatModelFactory = () => BaseChatModel;
```

生产实现根据 `LLM_PROVIDER` 创建具体模型。第一版只实现一个供应商分支；未知 Provider 直接抛出配置异常，避免静默使用错误模型。

模型参数由服务端控制：

- `model`
- `temperature`
- `timeout`

请求 DTO 不允许覆盖这些参数。

## Graph 状态

`llm.state.ts` 使用 LangGraph 的 `StateSchema` 和 `MessagesValue`：

```ts
import { MessagesValue, StateSchema } from '@langchain/langgraph';
import { z } from 'zod';

export const LlmState = new StateSchema({
  messages: MessagesValue,
  usage: z
    .object({
      inputTokens: z.number().nullable(),
      outputTokens: z.number().nullable(),
      totalTokens: z.number().nullable(),
    })
    .optional(),
});

export type LlmStateValue = typeof LlmState.State;
export type LlmStateUpdate = typeof LlmState.Update;
```

消息由 `MessagesValue` 管理追加和标准消息格式转换。Graph 节点返回状态更新，不直接修改传入状态。

## Graph 构建

`llm.graph.ts` 接收一个 LangChain Chat Model，创建并编译单节点 Graph：

```ts
import { END, START, StateGraph, type GraphNode } from '@langchain/langgraph';

import { LlmState } from './llm.state.js';

export const createLlmGraph = (model: BaseChatModel) => {
  const chatModelNode: GraphNode<typeof LlmState> = async (state) => {
    // 当前节点只负责调用模型，业务判断留给后续独立节点。
    const response = await model.invoke(state.messages);
    return {
      messages: [response],
      usage: normalizeUsage(response),
    };
  };

  return new StateGraph(LlmState)
    .addNode('chatModel', chatModelNode)
    .addEdge(START, 'chatModel')
    .addEdge('chatModel', END)
    .compile();
};
```

实际代码需要根据 LangChain 返回消息的类型导入 `AIMessage` 或通用消息类型，并将 `normalizeUsage` 放在 Graph 内部的纯函数中。

Graph 的输入只包含本次调用的消息，Graph 的输出包含最终消息和可选 Token 使用量。由于没有 Checkpointer，调用之间不会共享状态。

## Token 使用量标准化

不同供应商可能将 Token 数据放在 `usage_metadata` 或 `response_metadata` 中。模块内部统一转换为：

```ts
type LlmUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};
```

标准化规则：

1. 优先读取 LangChain 的标准 `usage_metadata`。
2. 兼容供应商返回的 `response_metadata.tokenUsage`。
3. 缺失字段使用 `null`。
4. 不根据文本长度估算 Token。

## DTO 和 API 映射

### 请求 DTO

`dto/chat.dto.ts` 定义两个 DTO：

```ts
enum ChatMessageRole {
  SYSTEM = 'system',
  USER = 'user',
  ASSISTANT = 'assistant',
}

class ChatMessageDto {
  role!: ChatMessageRole;
  content!: string;
}

class ChatDto {
  messages!: ChatMessageDto[];
}
```

校验规则：

- `messages` 必须是数组。
- 数量至少为 1，并设置最大数量。
- `role` 使用 `IsEnum`。
- `content` 使用 `IsString`、`MinLength` 和 `MaxLength`。
- 嵌套消息使用 `ValidateNested` 和 `Type`。
- 使用 `whitelist` 和 `forbidNonWhitelisted` 拒绝未知字段。

消息总长度和数量上限应设置为常量，避免客户端构造过大的模型请求。

### Service 输入输出

Controller 传入 DTO 后，Service 转换为不带 NestJS 装饰器的内部类型：

```ts
type ChatInput = {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
};

type ChatOutput = {
  content: string;
  model: string;
  usage: LlmUsage | null;
};
```

这样可以避免将 `class-validator` DTO 泄漏到模块内部。

## `LlmService` 实现职责

`LlmService` 负责：

1. 接收内部 `ChatInput`。
2. 调用编译好的 Graph。
3. 取出最终 `AIMessage`。
4. 将消息内容规范化为字符串。
5. 将 Token 使用量标准化。
6. 返回 `ChatOutput`。
7. 将上游错误转换为 NestJS 异常。

建议只暴露一个公开方法：

```ts
chat(input: ChatInput): Promise<ChatOutput>;
```

消息内容可能是字符串或多模态内容块。第一版只接受字符串输入；模型返回内容不是字符串时，Service 应明确转换策略或抛出上游响应错误，不能直接返回不确定结构。

## NestJS 注入关系

使用 Symbol Token 隔离具体实现：

```ts
export const LLM_CHAT_MODEL = Symbol('LLM_CHAT_MODEL');
export const LLM_GRAPH = Symbol('LLM_GRAPH');
```

`LlmModule` 的 Provider 关系：

```text
ConfigService
  -> LLM_CHAT_MODEL
  -> LLM_GRAPH
  -> LlmService
```

Graph Provider 依赖 `LLM_CHAT_MODEL`，`LlmService` 依赖 `LLM_GRAPH` 和模型名称配置。Graph 在依赖注入容器创建时编译一次。

模块注册示意：

```ts
@Module({
  controllers: [LlmController],
  providers: [
    ChatModelFactory,
    {
      provide: LLM_CHAT_MODEL,
      inject: [ChatModelFactory],
      useFactory: (factory: ChatModelFactory) => factory.create(),
    },
    {
      provide: LLM_GRAPH,
      inject: [LLM_CHAT_MODEL],
      useFactory: (model: BaseChatModel) => createLlmGraph(model),
    },
    LlmService,
  ],
  exports: [LlmService],
})
export class LlmModule {}
```

实际实现可根据 NestJS 类型推断调整 Provider 的类型声明，但不得让 Controller 直接依赖模型实例。

## Controller 和认证

Controller 实现：

```text
POST /api/llm/chat
  -> @Body() ChatDto
  -> LlmService.chat()
  -> ChatOutput
```

当前应用有全局 JWT Guard，因此不添加 `@Public()`。Controller 不读取当前用户信息，也不将用户信息自动拼入 Prompt。

## 异常转换

Service 需要区分以下异常：

| 内部场景         | NestJS 异常                   |
| ---------------- | ----------------------------- |
| 配置缺失或非法   | `ServiceUnavailableException` |
| 请求超时         | `GatewayTimeoutException`     |
| 供应商 4xx/5xx   | `BadGatewayException`         |
| 返回内容无法解析 | `BadGatewayException`         |

异常信息只提供稳定的中文错误描述和请求追踪信息，不返回：

- API Key。
- 完整供应商响应。
- 内部 Prompt。
- 可能包含敏感信息的上游错误详情。

## 测试技术方案

测试不调用真实模型服务。使用符合 LangChain Chat Model 接口的测试替身：

```text
FakeChatModel
  -> 接收消息
  -> 返回固定 AIMessage
  -> 可配置为抛出超时或供应商错误
```

测试分层：

1. DTO 单元测试：验证字段、角色、长度和未知字段。
2. Graph 单元测试：验证 `START -> chatModel -> END` 能输出消息。
3. Service 单元测试：验证消息转换、响应标准化和异常映射。
4. Controller 测试：验证路由调用 Service，并由全局 Guard 拦截未认证请求。
5. 手工 Smoke Test：配置真实 API Key 后调用一次 `/api/llm/chat`。

所属包需要增加 `test` 脚本，并将测试纳入后续 CI。测试替身不能依赖网络。

## 日志和可观测性

第一版只记录以下非敏感信息：

- 请求开始和结束。
- 模型名称。
- 请求耗时。
- 成功或失败状态。
- 标准化后的 Token 使用量。

默认不记录完整消息内容和模型返回内容。调试日志即使打开，也不得输出 API Key。

## 实现步骤

1. 使用 pnpm 安装兼容依赖，并确认锁文件变化范围。
2. 增加 `.env.example` 配置。
3. 实现 Provider 工厂和配置校验。
4. 实现 `LlmState` 和 `createLlmGraph()`。
5. 实现 `LlmService` 的响应和异常标准化。
6. 实现 DTO、Controller 和 `LlmModule`。
7. 在 `AppModule` 中注册 `LlmModule`。
8. 增加测试替身和单元测试。
9. 执行格式检查、类型检查、构建和所属包测试。
10. 配置真实模型后执行一次手工 HTTP Smoke Test。

## 验证命令

```bash
pnpm format:check
pnpm typecheck
pnpm build
pnpm --filter @clothes-shopping-guide/api test
pnpm check
```

真实调用验证应使用本地环境变量，不将 `.env` 或 API Key 加入 Git：

```bash
pnpm --filter @clothes-shopping-guide/api start:dev
curl -X POST http://localhost:3000/api/llm/chat \
  -H 'Authorization: Bearer <access-token>' \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"你好"}]}'
```

## 完成标准

- `LlmModule` 可以被 `AppModule` 加载。
- `POST /api/llm/chat` 受现有 JWT Guard 保护。
- LangGraph Graph 能稳定执行一次 Chat Model 调用。
- LangChain 消息和模型返回值已转换为模块自己的输入输出类型。
- 上游异常不会泄漏密钥和供应商内部详情。
- 自动化测试不需要真实 API Key。
- `pnpm check` 和所属包测试通过。
- 没有新增数据库表，也没有引入业务领域依赖。
