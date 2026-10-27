# Docker 实机全量测试记录

## 测试信息

- 测试日期：2026-10-28
- 测试环境：macOS + Docker Desktop 4.97.0
- Docker Context：`desktop-linux`
- 数据库：PostgreSQL 17 Alpine
- API 地址：`http://localhost:3000`
- 前端地址：`http://localhost:5173`

## 启动与数据库准备

启动 Docker Compose：

```bash
docker compose -f apps/api/docker-compose.yml up -d
```

确认容器状态：

```bash
docker compose -f apps/api/docker-compose.yml ps
```

结果：

- 容器：`api-postgres-1`
- 状态：`Up`
- 健康状态：`healthy`
- 端口映射：`5432:5432`

数据库初始化和迁移：

```bash
pnpm migration:fresh
pnpm --filter @clothes-shopping-guide/api migration:up
```

结果：

- 全部迁移执行成功
- `DatabaseSeeder` 执行成功
- `refresh_sessions` 表创建成功
- `migration:up` 返回 `Successfully migrated up to the latest version`

## 服务探活

| 检查项       | 请求                | 结果         |
| ------------ | ------------------- | ------------ |
| API 健康检查 | `GET /api/health`   | `200`        |
| Swagger 文档 | `GET /api/docs`     | `200`        |
| 前端首页     | `GET /`             | `200`        |
| 前端登录页   | 浏览器访问 `/login` | 页面正常渲染 |

## 用户认证全链路

使用临时测试用户和 Docker PostgreSQL 数据库完成以下验证：

| 场景                                  | 预期状态码 | 实际结果 |
| ------------------------------------- | ---------: | -------: |
| 注册用户                              |      `201` |     通过 |
| 获取当前用户                          |      `200` |     通过 |
| Refresh Token 刷新                    |      `200` |     通过 |
| Refresh Token 轮换后旧 Token 再次使用 |      `401` |     通过 |
| 退出登录                              |      `204` |     通过 |
| 退出后再次刷新                        |      `401` |     通过 |
| 使用密码登录                          |      `200` |     通过 |
| 登录用户访问用户资料                  |      `200` |     通过 |
| 管理员登录                            |      `200` |     通过 |
| 管理员查询用户列表                    |      `200` |     通过 |
| 管理员修改用户                        |      `200` |     通过 |
| 管理员禁用用户                        |      `200` |     通过 |
| 被禁用用户继续使用旧 Access Token     |      `401` |     通过 |

## 自动化检查

执行命令：

```bash
pnpm check
pnpm --filter @clothes-shopping-guide/api test
git diff --check
```

结果：

- `pnpm check`：通过
  - Prettier 格式检查通过
  - API、Web、Shared 类型检查通过
  - API 和 Web 生产构建通过
- API 测试：25 个测试全部通过
- `git diff --check`：通过

## 测试后工作区变更

迁移执行后更新了以下生成快照：

```text
apps/api/src/database/migrations/.snapshot-clothes_guide.json
```

该变更包含 `refresh_sessions` 表、索引和外键定义，属于 Refresh Token 持久化功能所需的迁移元数据。

## 结论

Docker PostgreSQL、NestJS API、Vue 3 前端和用户认证模块已完成本地实机全量验证。当前认证链路、Refresh Token 轮换、退出登录、管理员禁用用户后的 Token 失效行为均符合预期。
