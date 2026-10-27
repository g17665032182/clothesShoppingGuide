# 通用大模型模块实施文档

## 文档信息

- 关联设计文档：[通用大模型模块设计](./llm-module-design.md)
- 关联技术文档：[通用大模型模块技术文档](./llm-module-technical.md)
- 状态：待实施
- 实施方式：主代理统筹，子代理分工实施
- 所属应用：`apps/api`
- 最后更新：2026-10-27

## 实施目标

按照设计文档和技术文档，完成一个独立的 `LlmModule`：

- 使用 LangChain.js 调用 Chat Model。
- 使用 LangGraph.js 编排 `START -> chatModel -> END` 单节点流程。
- 提供受 JWT 保护的 `POST /api/llm/chat`。
- 统一配置、响应、Token 使用量和异常处理。
- 增加不依赖真实 API Key 的自动化测试。
- 不引入数据库表、业务领域依赖、RAG、Agent 或持久化会话。

本次实施必须使用子代理完成分工，主代理不得把全部实现集中在一个代理任务中。

## 开发流程总览

本次开发按“先确认边界，再拆分实施，最后统一集成”的顺序推进：

```text
需求确认
  -> 设计文档
  -> 技术文档
  -> 实施任务拆分
  -> 子代理并行开发
  -> 主代理整合
  -> 自动化验证
  -> 手工 Smoke Test
  -> 交付记录
```

### 1. 需求确认

主代理先确认本次只实现通用大模型模块，不扩展到商品、穿搭、RAG、Agent、会话持久化或其他业务能力。

产出：

- 明确模块名称：`LlmModule`。
- 明确接口：`POST /api/llm/chat`。
- 明确技术栈：LangChain.js + LangGraph.js。
- 明确非目标和验收边界。

### 2. 设计和技术文档

设计文档回答“做什么”和“暂时不做什么”；技术文档回答“如何实现”。

主代理在启动实施前必须确认两份文档已经同步，发现冲突时先更新文档，不直接在代码中自行扩大范围。

产出：

- 业务范围和 API 契约。
- 模块目录和依赖方向。
- Graph 状态、Provider、DTO、异常和测试方案。

### 3. 实施任务拆分

主代理根据文件所有权创建三个子代理任务：

- 子代理 A：依赖、配置和 Provider。
- 子代理 B：LangGraph 核心和 NestJS 模块。
- 子代理 C：测试替身和自动化测试。

拆分完成后，主代理向每个子代理发送其负责文件、禁止修改的公共文件、验收标准和报告模板。

### 4. 子代理开发

每个子代理先阅读项目规则、两份 LLM 文档、本地依赖和官方文档，再开始编码。

子代理开发期间：

- 只修改分配的文件。
- 不修改 `AppModule`、根配置、应用 `package.json` 和锁文件。
- 遇到跨边界问题先报告主代理。
- 完成后提交修改文件、验证命令、测试结果和风险。

### 5. 主代理整合

主代理按以下顺序整合：

1. 审阅子代理报告。
2. 确认依赖版本和安装结果。
3. 合并 Provider、Graph、Service、Controller、Module 和测试。
4. 修改 `AppModule` 注册 `LlmModule`。
5. 统一处理类型、导入扩展名和配置命名。
6. 检查没有数据库或业务模块耦合。

公共文件只由主代理修改，避免多个子代理对同一文件产生冲突。

### 6. 自动化验证

先执行快速检查，再执行全量检查：

```bash
pnpm --filter @clothes-shopping-guide/api test
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api build
pnpm check
git diff --check
```

自动化测试必须使用 Fake Chat Model，不访问真实模型服务。

### 7. 手工 Smoke Test

自动化检查通过后，配置本地真实模型环境变量，启动 API，使用有效 JWT 调用接口，确认：

- 认证请求可以成功调用模型。
- 未认证请求返回 `401`。
- 模型响应格式正确。
- Token 使用量缺失时返回 `null`。
- 上游错误和超时被转换为约定状态码。

### 8. 交付记录

主代理最终整理：

- 实际修改文件。
- 依赖和锁文件变化。
- 每个子代理的验证结果。
- `pnpm check` 和测试结果。
- Smoke Test 结果。
- 未解决风险或后续工作。

## 强制协作规则

### 角色

```text
主代理
  ├── 子代理 A：依赖、配置和 Provider
  ├── 子代理 B：LangGraph 核心和 NestJS 模块
  └── 子代理 C：测试替身和自动化测试
```

### 所有子代理的开始条件

每个子代理开始工作前必须：

1. 阅读 `AGENTS.md`。
2. 阅读本目录下的设计文档和技术文档。
3. 检查当前 Git 状态，保护已有未提交修改。
4. 查看与任务相关的本地依赖和脚本。
5. 阅读对应版本的 LangChain.js、LangGraph.js 官方文档。
6. 在开始消息中确认负责的文件范围。

### 所有子代理的结束报告

每个子代理完成后必须向主代理报告：

- 修改了哪些文件。
- 执行了哪些命令。
- 命令结果是否通过。
- 未解决的问题和风险。
- 是否修改了任务范围之外的文件。

### 并发和文件所有权

- 不允许两个子代理同时修改同一个文件。
- 子代理只能修改分配给自己的文件。
- `apps/api/src/app.module.ts`、根 `package.json`、`apps/api/package.json`、`pnpm-lock.yaml` 由主代理最终整合。
- 子代理发现需要修改非所属文件时，只能向主代理报告，不得自行扩展修改范围。
- 主代理负责处理依赖版本冲突、锁文件冲突和跨模块类型冲突。

## 文件所有权

### 子代理 A：依赖、配置和 Provider

负责：

```text
apps/api/.env.example
apps/api/src/llm/providers/chat-model.factory.ts
apps/api/src/llm/llm.tokens.ts
```

可提出但不得直接修改：

```text
apps/api/package.json
pnpm-lock.yaml
```

任务：

- 确认 LangChain、LangGraph、供应商集成包和 `zod` 的兼容版本。
- 阅读官方文档并确认当前 ESM、TypeScript 7 和 Node.js 22 配置可用。
- 设计 `ChatModel` 工厂。
- 读取和校验 `LLM_*` 环境变量。
- 定义 `LLM_CHAT_MODEL` 和 `LLM_GRAPH` 等注入 Token。
- 确保 API Key 不进入日志和异常响应。

交付标准：

- 能说明依赖版本选择依据。
- Provider 工厂返回 LangChain Chat Model 抽象。
- 缺少配置时抛出可识别的服务配置异常。
- 不依赖业务 Entity 或数据库。

### 子代理 B：LangGraph 核心和 NestJS 模块

负责：

```text
apps/api/src/llm/llm.state.ts
apps/api/src/llm/llm.graph.ts
apps/api/src/llm/llm.service.ts
apps/api/src/llm/llm.controller.ts
apps/api/src/llm/llm.module.ts
apps/api/src/llm/dto/chat.dto.ts
```

任务：

- 使用 `StateSchema` 和 `MessagesValue` 定义 Graph 状态。
- 实现单节点 `chatModel`。
- 编译 `START -> chatModel -> END` Graph。
- 将 LangChain 消息转换为模块内部类型。
- 实现 `LlmService.chat()`。
- 实现 `POST /api/llm/chat`。
- 增加 DTO 校验、消息数量限制和消息长度限制。
- 实现 `400/502/503/504` 异常映射。
- 不添加 `@Public()`，复用现有全局 JWT Guard。

交付标准：

- Graph 可以被 Fake Chat Model 调用。
- Controller 只依赖 `LlmService`。
- Controller 不直接创建供应商模型。
- 请求不允许覆盖模型名称、温度、超时或 API Key。
- 服务返回统一的 `content`、`model` 和 `usage`。

### 子代理 C：测试替身和自动化测试

负责：

```text
apps/api/src/llm/testing/fake-chat-model.ts
apps/api/src/llm/**/*.spec.ts
```

可提出但不得直接修改：

```text
apps/api/package.json
```

任务：

- 检查当前项目测试工具现状。
- 选择与当前 NestJS、ESM 和 TypeScript 配置兼容的测试工具。
- 实现 Fake Chat Model，不访问网络。
- 覆盖 DTO、Graph、Service、Controller 的关键行为。
- 覆盖正常返回、超时、供应商错误、配置错误和非法输入。
- 验证 JWT 保护行为，或者提供 Controller 层可独立验证的测试方案。

交付标准：

- 测试不需要真实 API Key。
- 测试不依赖外部网络。
- 能验证 `START -> chatModel -> END`。
- 能验证异常不会泄露 API Key。
- 给出需要主代理添加的 `test` 脚本和依赖清单。

## 主代理职责

主代理负责以下工作，不委托给多个子代理同时修改：

1. 建立实施任务和分配文件所有权。
2. 审阅设计文档、技术文档、AGENTS 规则和官方文档。
3. 决定最终依赖版本并执行 pnpm 安装。
4. 合并子代理的实现，处理类型和导入冲突。
5. 修改 `apps/api/src/app.module.ts` 注册 `LlmModule`。
6. 修改 `apps/api/package.json` 增加依赖和 `test` 脚本。
7. 更新 `pnpm-lock.yaml`。
8. 检查模块没有引入业务数据库和其他领域依赖。
9. 执行全量检查、自动化测试和手工 Smoke Test。
10. 汇总子代理报告，记录未解决风险。

## 实施阶段

### 阶段 0：实施前确认

主代理执行：

```bash
git status --short
sed -n '1,260p' docs/llm/llm-module-design.md
sed -n '1,360p' docs/llm/llm-module-technical.md
```

确认：

- 目标仍然是无状态通用 LLM 模块。
- 不新增数据库表。
- 不实现 Agent、RAG、流式输出和业务逻辑。
- 子代理文件所有权没有重叠。

### 阶段 1：依赖和 Provider

由子代理 A 实施。主代理根据其依赖建议执行：

```bash
pnpm --filter @clothes-shopping-guide/api add \
  @langchain/core @langchain/langgraph @langchain/openai zod
```

主代理需检查：

```bash
pnpm why @langchain/core
pnpm why @langchain/langgraph
pnpm why @langchain/openai
git diff -- apps/api/package.json pnpm-lock.yaml
```

### 阶段 2：Graph 和 NestJS 模块

由子代理 B 实施。要求：

- 使用 LangGraph `StateSchema`、`MessagesValue`、`StateGraph`。
- Graph 节点只返回状态更新，不直接修改状态。
- Chat Model 在 NestJS Provider 中初始化一次。
- `LlmService` 隐藏 LangChain 和 LangGraph 实现细节。
- Controller 复用现有全局 JWT Guard。

主代理检查：

```bash
pnpm --filter @clothes-shopping-guide/api typecheck
pnpm --filter @clothes-shopping-guide/api build
```

### 阶段 3：测试

由子代理 C 实施。测试框架选择必须考虑：

- 当前项目为 ESM。
- TypeScript 版本为 7。
- NestJS 版本为 12。
- Node.js 最低版本为 22。

如果当前仓库没有测试基础设施，子代理 C 先提出依赖和脚本变更，主代理统一安装和修改 `apps/api/package.json`，避免与其他代理产生冲突。

### 阶段 4：主代理集成

主代理依次执行：

1. 合并 Provider、Graph、Service、Controller、Module 和测试。
2. 将 `LlmModule` 加入 `AppModule`。
3. 检查所有源码导入使用 `.js` 扩展名。
4. 检查新增必要注释使用中文。
5. 检查 Controller 没有 `@Public()`。
6. 检查 API Key 没有出现在日志、响应和异常文本中。
7. 检查没有修改数据库 Entity、Migration 或 Seeder。

### 阶段 5：验证

主代理执行：

```bash
pnpm format:check
pnpm --filter @clothes-shopping-guide/api test
pnpm typecheck
pnpm build
pnpm check
git diff --check
```

配置真实模型后再执行手工验证：

```bash
pnpm --filter @clothes-shopping-guide/api start:dev
curl -X POST http://localhost:3000/api/llm/chat \
  -H 'Authorization: Bearer <access-token>' \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"你好"}]}'
```

## 验收标准

### 功能

- [ ] `LlmModule` 已注册到 `AppModule`。
- [ ] `POST /api/llm/chat` 可以调用 LangGraph。
- [ ] LangGraph `START -> chatModel -> END` 可以执行。
- [ ] LangChain Chat Model 从服务端配置创建。
- [ ] 响应包含 `content`、`model` 和 `usage`。

### 安全

- [ ] 接口受现有 JWT Guard 保护。
- [ ] 请求不能传入 API Key。
- [ ] 请求不能覆盖模型配置。
- [ ] API Key 不出现在日志、响应和异常文本中。
- [ ] 消息数量和长度受到限制。

### 异常

- [ ] 非法 DTO 返回 `400`。
- [ ] 缺少或无效 JWT 返回 `401`。
- [ ] 供应商调用错误返回 `502`。
- [ ] 配置缺失返回 `503`。
- [ ] 调用超时返回 `504`。

### 工程

- [ ] 测试使用 Fake Chat Model，不访问真实网络。
- [ ] `apps/api` 提供可执行的 `test` 脚本。
- [ ] 没有新增数据库表和业务 Entity。
- [ ] 没有引入商品、穿搭、RAG、Agent 或会话持久化。
- [ ] `pnpm check` 通过。
- [ ] `git diff --check` 通过。

## 风险和处理

| 风险                           | 处理方式                                                             |
| ------------------------------ | -------------------------------------------------------------------- |
| LangChain 包版本或导出路径变化 | 子代理开始前读取官方文档，主代理统一锁定版本并运行类型检查           |
| LangGraph 状态类型不兼容       | 使用官方 `StateSchema` 和 `MessagesValue` 示例，先用 Fake Model 验证 |
| 供应商 Token 字段不统一        | 在 Graph 或 Service 内统一解析，缺失字段返回 `null`                  |
| 测试框架与 ESM/TS 7 不兼容     | 子代理 C 先验证最小测试，再由主代理安装                              |
| 多代理修改同一文件             | 严格执行文件所有权，公共文件只由主代理修改                           |
| 上游错误泄露敏感数据           | 统一异常映射，只输出稳定中文错误                                     |
| 请求过大导致成本和超时         | DTO 限制消息数量、单条长度和总长度                                   |

## 子代理交付模板

每个子代理完成后必须按以下格式返回：

```text
任务：

修改文件：
- path/to/file

执行命令：
- command

结果：
- 通过/失败

测试：
- 测试名称和结果

未解决风险：
- none 或具体说明

越界修改：
- none 或具体说明
```

只有主代理完成集成、全量验证和风险汇总后，本实施任务才算完成。
