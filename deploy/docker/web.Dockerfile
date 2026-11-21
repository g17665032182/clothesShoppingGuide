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
RUN pnpm --filter @clothes-shopping-guide/web build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html

EXPOSE 8080
