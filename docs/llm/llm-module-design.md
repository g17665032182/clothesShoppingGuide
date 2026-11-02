# 通用大模型模块设计

本文件描述通用 `LlmModule` 的基础边界。聊天历史和工具事件的节点级持久化设计见
[`chat-history-persistence-design.md`](./chat-history-persistence-design.md)，不改变本模块不直接依赖具体业务数据库的原则。

## 状态与上下文

- 状态：已实现（工具由调用方注入，当前未内置业务工具）
- 模块名称：`LlmModule`
- 业务定位：为 API 提供统一的大模型文本调用能力
- 技术栈：NestJS、LangChain.js、LangGraph.js、TypeScript
- 所属应用：`apps/api`
- 最后更新：2026-10-27

## 目标

第一版只提供一个与具体业务无关的通用大模型模块：

- 使用 LangChain 创建和调用 Chat Model。
- 使用 LangGraph 编排一次最小模型调用流程。
- 通过 NestJS Module、Service 和 Controller 对外提供能力。
- 统一模型配置、错误处理和响应格式。
- 支持通过 LangGraph `ToolNode` 执行调用方注入的工具，并保持工具与业务模块解耦。

## 明确不包含

第一版不包含以下能力：

- 由通用模块直接负责的对话记录持久化和业务数据库表。
- 用户画像、商品、穿搭或其他业务逻辑。
- RAG、向量数据库和 Embedding。
- Agent 自主规划和内置业务工具。
- 多模型路由和自动降级。
- 流式输出。
- 前端页面。

## 设计原则

1. `LlmModule` 只负责模型调用和工作流编排，不理解业务领域。
2. 业务模块只依赖 `LlmService` 的公开接口，不直接创建 LangChain 模型。
3. LangChain 负责模型和消息抽象，LangGraph 负责状态和节点编排。
4. 模型实例和已编译 Graph 在模块初始化时创建，避免每次请求重复初始化。
5. 模型供应商通过适配层隔离，业务代码不依赖具体供应商 SDK。
6. 所有输入先经过 DTO 校验，模型返回值经过统一转换后再返回 API。

## 模块结构

```text
apps/api/src/llm/
  llm.module.ts
  llm.controller.ts
  llm.service.ts
  llm.graph.ts
  llm.state.ts
  dto/
    chat.dto.ts
  providers/
    chat-model.factory.ts
```

### 文件职责

| 文件                              | 职责                                                          |
| --------------------------------- | ------------------------------------------------------------- |
| `llm.module.ts`                   | 注册 Controller、Service、模型工厂和 Graph                    |
| `llm.controller.ts`               | 提供 HTTP 接口，处理请求和响应                                |
| `llm.service.ts`                  | 对外提供稳定的 LLM 调用接口，隐藏 LangChain 和 LangGraph 细节 |
| `llm.graph.ts`                    | 创建、连接并编译 LangGraph                                    |
| `llm.state.ts`                    | 定义 Graph 使用的状态结构                                     |
| `dto/chat.dto.ts`                 | 定义请求消息和参数校验                                        |
| `providers/chat-model.factory.ts` | 根据配置创建 LangChain Chat Model                             |

## 依赖选择

实现时使用以下依赖：

```text
@langchain/core
@langchain/langgraph
对应供应商的 LangChain 集成包
zod
```

第一版不引入 LangChain Agent、LangChain Community 或其他大型扩展包。供应商集成包根据实际使用的模型服务选择，优先使用官方维护的 LangChain 集成。

当前仓库尚未安装上述依赖。实现前需要阅读对应版本的官方文档，并确认其与当前 NestJS、TypeScript 和 ESM 配置兼容后再写入 `apps/api/package.json`。

## 运行架构

```text
POST /api/llm/chat
        |
        v
LlmController
        |
        v
LlmService
        |
        v
LangGraph
  START -> chatModel --无工具调用--> END
                  \--有工具调用--> tools -> chatModel
                                      |
                                      v
                                LangChain Chat Model
                                      |
                                      v
                                  模型供应商
```

Graph 由 `chatModel` 和 LangGraph 官方 `ToolNode` 组成。模型返回工具调用时进入 `ToolNode`，工具结果追加到消息状态后再次调用模型；模型返回普通回答时结束。具体工具通过 `createLlmGraph(model, tools)` 注入，通用模块不创建商品、穿搭等领域工具。

## LangGraph 状态

Graph 状态只保存本次请求所需的数据，不写入数据库：

```text
messages: LangChain 消息列表
response: 模型生成的 AI 消息
usage: 可选的 Token 使用量
```

Graph 节点应读取当前状态并返回状态更新，不直接修改原状态。消息状态使用 LangGraph 的消息状态能力，模型节点调用 LangChain Chat Model 的 `invoke()` 方法。

## API 契约

### 聊天调用

| 操作       | 方法与路由           | 认证       | 成功状态码 |
| ---------- | -------------------- | ---------- | ---------- |
| 调用大模型 | `POST /api/llm/chat` | Bearer JWT | `200`      |

接口沿用应用的全局 `/api` 前缀和 JWT Guard。第一版不将该接口标记为公开接口，客户端不能直接传入 API Key 或供应商配置。

### 请求体

```json
{
  "messages": [
    {
      "role": "user",
      "content": "你好，请介绍一下自己"
    }
  ]
}
```

字段规则：

| 字段                 | 类型                          | 必填 | 规则                                       |
| -------------------- | ----------------------------- | ---- | ------------------------------------------ |
| `messages`           | `ChatMessage[]`               | 是   | 至少一条，限制总消息数量                   |
| `messages[].role`    | `system \| user \| assistant` | 是   | 仅允许已定义角色                           |
| `messages[].content` | `string`                      | 是   | 去除首尾空白，不允许空字符串，限制单条长度 |

请求 DTO 的 OpenAPI 元数据与 Zod 请求 schema 分离；schema 通过 Nest `StandardSchemaValidationPipe` 校验，拒绝未声明字段。省略模型名称、温度和 Token 上限等模型参数，第一版统一由服务端环境变量控制。

### 响应体

```json
{
  "content": "你好，我是一个大模型助手。",
  "model": "configured-model",
  "usage": {
    "inputTokens": 10,
    "outputTokens": 12,
    "totalTokens": 22
  }
}
```

`usage` 由供应商返回时提供；供应商未返回时使用 `null`，不伪造 Token 数量。

### 错误行为

| 场景             | HTTP 状态码 | 说明                   |
| ---------------- | ----------- | ---------------------- |
| 请求消息格式非法 | `400`       | DTO 校验失败           |
| LLM 配置缺失     | `503`       | 服务未完成配置         |
| 模型调用超时     | `504`       | 超过服务端超时限制     |
| 供应商返回错误   | `502`       | 统一转换为上游调用错误 |
| 缺少或无效 JWT   | `401`       | 复用现有全局认证 Guard |

错误响应沿用 NestJS 默认异常格式，内部 API Key、完整供应商响应和 Prompt 内容不得写入错误消息。

## 配置

建议在 `apps/api/.env.example` 增加以下配置：

```env
LLM_PROVIDER=openai-compatible
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=
LLM_TEMPERATURE=0.7
LLM_TIMEOUT_MS=30000
```

配置要求：

- `LLM_API_KEY` 只从服务端环境变量读取。
- `LLM_BASE_URL` 为空时使用供应商 SDK 的默认地址。
- `LLM_MODEL` 必须有值，禁止客户端覆盖。
- `LLM_TEMPERATURE` 和 `LLM_TIMEOUT_MS` 由配置服务解析并校验。
- 启动时可以检查必填配置，但错误信息不得打印密钥内容。

## 服务接口

`LlmService` 对外只暴露与 LangChain 无关的业务接口：

```text
chat(input: ChatInput): Promise<ChatOutput>
```

Controller 只依赖 `LlmService`。Graph、Chat Model 和供应商配置都属于模块内部实现，其他模块不能引用 `llm.graph.ts` 或供应商实例。

## 测试设计

第一版至少补充以下测试：

- DTO 拒绝空消息、未知角色和超长内容。
- `LlmService` 能把请求消息转换为 LangChain 消息并调用 Graph。
- Graph 的单节点流程能返回模型内容。
- 模型供应商异常被转换为统一的 NestJS 异常。
- 缺少配置时模块启动或调用会返回明确错误。
- 使用假的 Chat Model 测试，不依赖真实 API Key。

真实模型调用只作为手工 Smoke Test，不作为默认自动化测试的一部分。

## 实现顺序

1. 阅读当前 LangChain.js 和 LangGraph.js 官方文档，确认 ESM 和 TypeScript 用法。
2. 安装兼容版本的 LangChain、LangGraph、供应商集成包和 `zod`。
3. 增加配置读取和 `ChatModel` 工厂。
4. 定义 Graph 状态并实现 `START -> chatModel -> END`。
5. 实现 `LlmService` 和 `POST /api/llm/chat`。
6. 接入 `AppModule`，确认全局 JWT Guard 行为符合预期。
7. 增加单元测试和 `test` 脚本。
8. 更新 `.env.example` 和 API 文档。
9. 执行 `pnpm check` 及所属包测试。

## 验收清单

- [ ] `LlmModule` 已注册到 `AppModule`。
- [ ] LangChain Chat Model 能从环境变量创建。
- [x] LangGraph 模型节点、工具节点和条件路由已编译并可执行。
- [x] 工具调用结果会回到模型节点生成最终回答。
- [ ] `POST /api/llm/chat` 已实现并受 JWT 保护。
- [ ] 请求 DTO、响应格式和错误行为符合本设计。
- [ ] API Key 不接受客户端传入，也不会出现在日志和异常响应中。
- [ ] 没有新增业务数据库表。
- [x] 没有引入商品、穿搭、RAG、Agent 或持久化会话逻辑。
- [ ] 已补充使用假模型的自动化测试。
- [ ] `pnpm check` 和所属包测试通过。

## 后续扩展边界

后续如果确实需要，可以在不改变 `LlmService` 基础边界的前提下增加：

- `withStructuredOutput()` 结构化输出。
- 更多业务工具和工具权限控制。
- LangGraph 多节点流程。
- SSE 流式响应。
- 具体聊天业务的会话持久化（见节点级聊天历史持久化设计）。
- 多供应商和模型路由。

这些能力不属于本次第一版实现范围。
