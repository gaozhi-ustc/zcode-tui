#!/usr/bin/env bash
# zcode-tui wrapper — 自适应路径 + 子命令拦截（login/config/logout）
set -euo pipefail

# 推导 zcode-tui 目录（环境变量 > 脚本位置推导 > 默认）
ZCODE_TUI_DIR="${ZCODE_TUI_DIR:-}"
if [ -z "$ZCODE_TUI_DIR" ] || [ ! -d "$ZCODE_TUI_DIR/src" ]; then
  SELF_DIR="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
  if [ -f "$SELF_DIR/../src/main.js" ]; then
    ZCODE_TUI_DIR="$(cd "$SELF_DIR/.." && pwd)"
  elif [ -d "/opt/zcode-tui/src" ]; then
    ZCODE_TUI_DIR="/opt/zcode-tui"
  elif [ -d "$HOME/zcode-tui/src" ]; then
    ZCODE_TUI_DIR="$HOME/zcode-tui"
  else
    echo "错误：找不到 zcode-tui 目录。设置 ZCODE_TUI_DIR 环境变量。" >&2
    exit 1
  fi
fi

# 查找引擎路径（优先级：env > local > /opt）
ZCODE_ENGINE="${ZCODE_ENGINE_PATH:-}"
[ -f "$ZCODE_ENGINE" ] || ZCODE_ENGINE="$HOME/.local/share/zcode/zcode.cjs"
[ -f "$ZCODE_ENGINE" ] || ZCODE_ENGINE="/opt/zcode-engine/zcode.cjs"
[ -f "$ZCODE_ENGINE" ] || ZCODE_ENGINE="/opt/ZCode/resources/glm/zcode.cjs"
export ZCODE_ENGINE_PATH="$ZCODE_ENGINE"

# node:sqlite 在 Node 22/23 仍为实验特性，引擎依赖它，须显式启用 flag（Node 24+ 起免 flag）。
# 用 NODE_OPTIONS 而非 CLI flag，可同时覆盖 login/logout/legacy 的直接 engine 调用与 TUI spawn 的子进程。
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null && [ "$NODE_MAJOR" -lt 24 ]; then
  case " ${NODE_OPTIONS:-} " in
    *" --experimental-sqlite "*) ;;
    *) export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--experimental-sqlite" ;;
  esac
fi

# === 子命令拦截 ===
case "${1:-}" in
  login)
    if [ ! -f "$ZCODE_ENGINE" ]; then
      echo "错误：ZCode 引擎未找到。请先安装。" >&2; exit 1
    fi
    echo "启动 z.ai 登录（device-code 模式）..."
    echo "会打印一个 URL，在任何有浏览器的设备打开即可完成登录。"
    echo ""
    exec node "$ZCODE_ENGINE" login --no-browser "${@:2}"
    ;;
  logout)
    [ ! -f "$ZCODE_ENGINE" ] && { echo "引擎未找到" >&2; exit 1; }
    exec node "$ZCODE_ENGINE" logout "${@:2}"
    ;;
  config)
    shift
    CLI_CONFIG="$HOME/.zcode/cli/config.json"
    case "${1:-}" in
      --apikey)
        if [ -z "${2:-}" ]; then echo "用法: zcode config --apikey <key>" >&2; exit 1; fi
        mkdir -p "$(dirname "$CLI_CONFIG")"
        cat > "$CLI_CONFIG" << 'CFGEOF'
{
  "model": "builtin:bigmodel-coding-plan/GLM-5.2",
  "provider": {
    "builtin:bigmodel-coding-plan": {
      "name": "Bigmodel - Coding Plan",
      "kind": "anthropic",
      "options": {
        "baseURL": "https://open.bigmodel.cn/api/anthropic",
        "apiKey": "__APIKEY__"
      },
      "enabled": true
    }
  }
}
CFGEOF
        sed -i "s|__APIKEY__|$2|" "$CLI_CONFIG"
        chmod 600 "$CLI_CONFIG"
        echo "✓ 配置已写入 $CLI_CONFIG"
        ;;
      --show)
        if [ -f "$CLI_CONFIG" ]; then
          python3 -c "
import json
c=json.load(open('$CLI_CONFIG'))
for k,v in c.get('provider',{}).items():
  ak=v.get('options',{}).get('apiKey','')
  masked=ak[:8]+'***'+ak[-4:] if len(ak)>12 else '***'
  print(f'  provider: {k}')
  print(f'    baseURL: {v.get(\"options\",{}).get(\"baseURL\",\"?\")}')
  print(f'    apiKey:  {masked}')
  print(f'    enabled: {v.get(\"enabled\",False)}')
print(f'  model: {c.get(\"model\",\"?\")}')" 2>/dev/null || cat "$CLI_CONFIG"
        else
          echo "未配置。运行: zcode config --apikey <key>  或  zcode login"
        fi
        ;;
      *)
        echo "用法: zcode config --apikey <key>  |  zcode config --show"
        ;;
    esac
    exit 0
    ;;
esac

# === 逃生舱 ===
if [ "${ZCODE_CLI_LEGACY:-0}" = "1" ]; then
  exec node "$ZCODE_ENGINE" "$@"
fi

# === 非 TTY 降级 ===
if [ ! -t 0 ] || [ ! -t 1 ] || [ "${TERM:-}" = "dumb" ]; then
  echo "zcode: 当前终端不支持全屏 TUI (TERM=${TERM:-unset})。" >&2
  echo "  用单次模式: node $ZCODE_ENGINE -p \"你的问题\"" >&2
  exit 1
fi

exec node "$ZCODE_TUI_DIR/src/main.js" "$@"
