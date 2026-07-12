#!/usr/bin/env bash
# zcode-ssh-tui wrapper — 把 shell 里的 zcode 路由到自建 TUI
set -euo pipefail

PROJECT_DIR="/home/gaozhi/ZCodeProject"

# 逃生舱:显式要原生 CLI
if [ "${ZCODE_CLI_LEGACY:-0}" = "1" ]; then
  exec node /opt/ZCode/resources/glm/zcode.cjs "$@"
fi

# 非 TTY 或 dumb 终端:降级提示
if [ ! -t 0 ] || [ ! -t 1 ] || [ "${TERM:-}" = "dumb" ]; then
  echo "zcode: 当前终端不支持全屏 TUI (TERM=${TERM:-unset}, 非 TTY)。" >&2
  echo "  用单次模式: node /opt/ZCode/resources/glm/zcode.cjs -p \"你的问题\"" >&2
  echo "  或在交互式 ssh 会话(分配伪终端)里运行。" >&2
  exit 1
fi

exec node "${PROJECT_DIR}/src/main.js" "$@"
