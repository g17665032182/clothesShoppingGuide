---
name: nestjs-mikroorm-crud
description: 初始化 NestJS、MikroORM、PostgreSQL 后端项目或实现基础 CRUD 模块时使用。若现有项目使用不同技术栈，保留原选型并查阅对应官方文档，不擅自迁移。
---

# NestJS + MikroORM + PostgreSQL 后端与 CRUD

用于初始化空后端项目，或在现有项目中新增基础 CRUD 资源。默认技术栈是 NestJS、MikroORM 和 PostgreSQL；以仓库实际依赖和用户决策为准。

## 开始前检查

1. 阅读 `AGENTS.md`、`CLAUDE.md` 等项目指令，检查 Git 状态、包清单和锁文件、依赖版本、ORM 配置及一个相似模块。保留无关和未提交改动。
2. 先检查项目已安装的库、CLI、现有模块及本地文档。本地方案不能满足需求时，再查找并验证合适的开源库；没有合适方案时才自行实现基础设施。
3. 判断项目是空项目、已使用默认技术栈、部分配置，还是使用其他技术栈。若现有栈不同，保留其框架、ORM 和数据库；使用 API 或命令前查阅与实际安装版本匹配的文档，不得静默迁移项目。
4. 根据锁文件和 `packageManager` 字段沿用项目包管理器，不要创建第二份锁文件。空项目没有任何线索且用户未指定时，使用 pnpm，并在安装前说明。

## 初始化空项目

确认目标目录和项目名称。使用所选包管理器调用 Nest CLI，不覆盖已有文件。pnpm 的常见起点：

```bash
pnpm dlx @nestjs/cli new <project-name> --package-manager pnpm
```

生成骨架后，查阅当前 NestJS 和 MikroORM 文档，确定兼容版本，再添加 PostgreSQL 驱动、Nest 集成、迁移、反射/Decorator 支持和请求校验依赖。默认技术栈的 pnpm 安装通常包括：

```bash
pnpm add @mikro-orm/core @mikro-orm/nestjs @mikro-orm/postgresql @mikro-orm/migrations @mikro-orm/reflection @mikro-orm/decorators zod
pnpm add -D @mikro-orm/cli
```

仅在模板或用户需求需要时添加 Seeder 或 HTTP 适配器。确保 MikroORM 各包版本兼容。应用和迁移 CLI 应使用一致的环境变量配置；不要把密钥写入受 Git 跟踪的文件。新增业务资源前，先构建并运行脚手架已有检查。

## 确认 CRUD 契约

每个资源开始实现前，从[契约模板](references/crud-contract.md)创建 `docs/contracts/<resource>-crud-contract.md`，并将填写完成的契约保留在项目中，供实现和审查共同使用。

记录业务范围、字段名称与类型、创建/更新必填规则、可空性、默认值、唯一/索引范围、校验、关联与删除行为、读写范围、API 路由与响应结构、分页/过滤/排序、认证与资源所有权、错误行为、迁移兼容性和验收项。注明每项决策来源：用户需求、用户确认或具体的项目现有约定。

需求已明确的约束应记录来源并标为已确认，不要要求用户重复说明。若影响数据、授权、兼容性或 API 行为的约束有歧义，将契约标为“待确认”，汇总问题一次性询问，并暂停 CRUD 实现。未得到答复前，不得创建或修改 Entity、DTO、Guard、Decorator、Pipe 或数据库迁移。不得把 Agent 的假设当成已确认的业务规则。

## 实现资源模块

沿用项目已有结构和 CLI。对于现有 Nest 项目，只用已安装的 CLI 生成需要的骨架，例如：

```bash
pnpm exec nest g module <resource>
pnpm exec nest g service <resource>
pnpm exec nest g controller <resource>
```

根据项目包管理器调整命令；不确定 CLI 参数时，先核对已安装版本的文档。

- Entity 只表达持久化结构和数据库约束。
- 为创建、更新、查询请求分别在模块的 `dto/` 中定义 Zod schema，通过全局 Nest `StandardSchemaValidationPipe` 和 `@Body({ schema })`、`@Query({ schema })`、`@Param({ schema })` 绑定；类型从 schema 派生。对象请求默认使用 `z.strictObject`，明确转换、默认值、可空性和未知字段策略。Swagger DTO 仅提供 API 文档元数据，不作为运行时校验来源；不得新增 `class-validator` / `class-transformer` 或 Controller 手动校验。
- 业务规则和持久化逻辑放在 Service；Controller 只处理 HTTP 参数绑定和调用。
- 按项目现有 MikroORM 模式注册 Entity Repository。
- 复用现有认证、公开路由标记、授权、当前用户 Decorator 和输入校验。只有存在明确且可复用的独立需求时才添加 Guard、Decorator 或 Pipe，并在契约中说明原因。
- 按下述目录规范组织模块内的辅助组件；新增或移动时同步更新所有引用、模块注册和文件内部的相对导入路径。
- 保持模块高内聚、低耦合。新增代码注释使用简洁中文。
- Entity 变更要生成并审查迁移，执行前检查 SQL 和兼容性。除非用户明确授权且目标数据库可销毁，否则不得使用会清库的 reset/fresh 命令。

## 模块目录规范

业务模块根目录必须保持精简，避免把大量实现文件直接堆在模块根目录。每个业务模块自行维护职责目录，不建立跨业务模块共享的全局 `entity/` 或 `spec/` 目录：

```text
<module>/
  <module>.module.ts
  controller/
  service/
  entity/
  dto/
  spec/
```

按职责将同类文件放在所属业务模块的子目录中，目录名称使用单数；只有存在对应文件时才创建目录：

- Controller：`controller/*.controller.ts`。
- Service：`service/*.service.ts`。
- Entity：`entity/*.entity.ts`。
- 测试：`spec/*.spec.ts`。
- 自定义 Decorator：`decorator/*.decorator.ts`。
- Guard：`guard/*.guard.ts`。
- Pipe：`pipe/*.pipe.ts`。
- Interceptor：`interceptor/*.interceptor.ts`。
- Exception Filter：`filter/*.filter.ts`。
- Middleware：`middleware/*.middleware.ts`。
- 请求 DTO：`dto/*.dto.ts`。

当一个业务能力包含多个紧密协作的文件时，可以在模块内使用表达业务意图的目录，例如 `context/`、`history/`、`trace/`；不要为单个文件机械创建目录，也不要为了减少文件数量把不同职责堆进一个 Service。目录拆分应服务于高内聚、低耦合和可读性。

例如 JWT Guard 放在 `auth/guard/`，角色 Guard 放在 `authorization/guard/`，用户实体放在 `users/entity/`，聊天记录实体放在 `chat-records/entity/`，对应测试放在各自模块的 `spec/`。保留组件的业务模块归属，不因文件类型相同就合并到全局目录。移动文件时必须同步更新 import、模块注册、测试发现路径，并搜索确认没有遗留旧路径引用。

## 验证与汇报

对照已确认的契约检查实现。按需覆盖创建、列表、详情、更新、删除、Zod 输入校验、授权、冲突、不存在资源和关联行为。校验测试应覆盖合法输入、非法边界、未知字段拒绝、默认值/转换结果，以及请求层 400 错误行为。运行仓库现有测试、构建、格式/类型检查和迁移状态检查，并如实报告命令和结果。不得声称未运行的检查已通过。审查最终差异，排除无关改动、密钥和破坏性 SQL。

按模块目录规范检查新增或调整模块中的 Decorator、Guard、Pipe、Interceptor、Filter、Middleware 和 DTO，确认同类文件位于对应子目录，并搜索确认没有遗留旧路径引用。检查模块注册、依赖注入及跨模块调用仍指向移动后的组件。纯目录整理应保持原有行为，不夹带业务逻辑修改。
