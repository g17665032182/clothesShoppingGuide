# syntax=docker/dockerfile:1.7

FROM node:22.19.0-alpine AS base

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

RUN npm install --global pnpm@12.14.0

WORKDIR /workspace

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .node-version ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json

RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY . .
RUN pnpm --filter @clothes-shopping-guide/api build

# 迁移 Job 需要 MikroORM CLI，因此保留完整依赖；API 运行镜像只复制生产依赖。
FROM build AS migration

ENV NODE_ENV=production

USER node
CMD ["pnpm", "--dir", "apps/api", "exec", "mikro-orm", "migration:up", "--config", "./dist/mikro-orm.config.js"]

FROM build AS production-dependencies

RUN pnpm --filter @clothes-shopping-guide/api deploy --prod /app

FROM node:22.19.0-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=production-dependencies /app ./
COPY --from=build /workspace/apps/api/dist ./dist

USER node
EXPOSE 3000

CMD ["node", "dist/main.js"]
