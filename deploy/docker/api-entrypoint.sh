#!/bin/sh
set -eu

# 每次容器启动先完成数据库初始化，任一步失败都阻止 API 提供流量。
node ./api-bootstrap.mjs

exec node dist/main.js
