#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}ℹ${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*" >&2; }

TUI_DIR="${ZCODE_TUI_DIR:-$HOME/zcode-tui}"
ENGINE_DIR="$HOME/.local/share/zcode"
ENGINE_PATH="$ENGINE_DIR/zcode.cjs"
CLI_DIR="$HOME/.zcode/cli"
CLI_CONFIG="$CLI_DIR/config.json"
WRAPPER="$HOME/.local/bin/zcode"

echo ""; echo "╔════════════════════════════════╗"; echo "║   zcode-tui 一键安装           ║"; echo "╚════════════════════════════════╝"; echo ""

# 1. Node.js
info "检查 Node.js..."
if command -v node &>/dev/null; then
  MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$MAJOR" -ge 22 ]; then ok "Node.js $(node -v)"
  else warn "Node.js $(node -v) 过低，升级..."; curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash; export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; nvm install 24; ok "Node.js $(node -v)"; fi
else info "安装 Node.js..."; curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash; export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; nvm install 24; ok "Node.js $(node -v)"; fi

# 2. clone
info "安装 zcode-tui..."
if [ -d "$TUI_DIR/.git" ]; then cd "$TUI_DIR" && git pull --ff-only; else git clone https://github.com/gaozhi-ustc/zcode-tui.git "$TUI_DIR"; fi
cd "$TUI_DIR" && npm install --silent; ok "代码 → $TUI_DIR"

# 3. 引擎（自动从 GitHub Release 下载，无需从本机拷贝）
info "检查引擎..."
ENG=""
[ -f "/opt/ZCode/resources/glm/zcode.cjs" ] && { ok "GUI引擎: /opt/ZCode/..."; ENG="/opt/ZCode/resources/glm/zcode.cjs"; } || true
[ -z "$ENG" ] && [ -f "$ENGINE_PATH" ] && { ok "已有引擎: $ENGINE_PATH"; ENG="$ENGINE_PATH"; } || true
if [ -z "$ENG" ]; then
  info "从 GitHub Release 自动下载引擎 (zcode.cjs, ~9MB)..."
  mkdir -p "$ENGINE_DIR"
  ENGINE_URL="https://github.com/gaozhi-ustc/zcode-tui/releases/download/v0.1.0/zcode.cjs"
  if curl -fsSL "$ENGINE_URL" -o "$ENGINE_PATH" && [ -f "$ENGINE_PATH" ] && [ -s "$ENGINE_PATH" ]; then
    ok "引擎已下载到 $ENGINE_PATH"
    ENG="$ENGINE_PATH"
  else
    rm -f "$ENGINE_PATH"
    warn "自动下载失败。手动方式："
    warn "  scp /opt/ZCode/resources/glm/zcode.cjs 目标:$ENGINE_PATH"
    read -p "  或输入引擎文件路径/URL(留空跳过): " UE
    if [ -n "$UE" ]; then
      [[ "$UE" == http* ]] && curl -fsSL "$UE" -o "$ENGINE_PATH" || [ -f "$UE" ] && cp "$UE" "$ENGINE_PATH"
      [ -f "$ENGINE_PATH" ] && [ -s "$ENGINE_PATH" ] && ENG="$ENGINE_PATH" && ok "引擎已装" || warn "引擎未装"
    fi
  fi
fi

# 4. wrapper
info "安装wrapper..."; mkdir -p "$(dirname "$WRAPPER")"; cp "$TUI_DIR/src/zcode-wrapper.sh" "$WRAPPER"; chmod +x "$WRAPPER"
# 把安装时的实际 clone 位置写入 wrapper 作为默认（仍可用 ZCODE_TUI_DIR 覆盖）
sed -i "s|^ZCODE_TUI_DIR=\"\\\${ZCODE_TUI_DIR:-}\"|ZCODE_TUI_DIR=\"\\\${ZCODE_TUI_DIR:-$TUI_DIR}\"|" "$WRAPPER"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"; export PATH="$HOME/.local/bin:$PATH";; esac
ok "zcode命令就绪"

# 5. 认证
echo ""; echo "══════ 认证配置 ══════"
HC=false; [ -f "$CLI_CONFIG" ] && python3 -c "import json;c=json.load(open('$CLI_CONFIG'));ak=list(c.get('provider',{}).values())[0].get('options',{}).get('apiKey','') if c.get('provider') else '';exit(0 if ak and len(ak)>10 else 1)" 2>/dev/null && HC=true && ok "已有有效配置" || true
if [ "$HC" = false ]; then
  echo "  1) 浏览器登录z.ai(device-code)"; echo "  2) API Key"; echo "  3) 跳过"; read -p "选择[1-3]: " CH
  case "$CH" in
    1) [ -z "$ENG" ] && err "引擎未装" || { info "启动登录..."; node "$ENG" login --no-browser && ok "登录成功" || warn "稍后:zcode login"; };;
    2) echo "  获取:https://open.bigmodel.cn/console/apikey"; read -p "  API Key: " AK; if [ -n "$AK" ]; then mkdir -p "$CLI_DIR"; printf '{"model":"builtin:bigmodel-coding-plan/GLM-5.2","provider":{"builtin:bigmodel-coding-plan":{"name":"Bigmodel","kind":"anthropic","options":{"baseURL":"https://open.bigmodel.cn/api/anthropic","apiKey":"%s"},"enabled":true}}}' "$AK" > "$CLI_CONFIG"; chmod 600 "$CLI_CONFIG"; ok "配置已写入"; fi;;
    3) warn "稍后:zcode login 或 zcode config --apikey <key>";;
  esac
fi

# 6. 验证
echo ""; echo "══════ 安装验证 ══════"
[ -n "$ENG" ] && [ -f "$ENG" ] && ok "引擎:$ENG" || warn "引擎:未装"
[ -f "$CLI_CONFIG" ] && ok "配置:$CLI_CONFIG" || warn "配置:未创建"
[ -x "$WRAPPER" ] && ok "命令:$WRAPPER" || warn "命令:未装"
command -v zcode &>/dev/null && ok "PATH:可用" || warn "PATH:source ~/.bashrc"
echo ""; echo "✓ 安装完成！启动:zcode  登录:zcode login  配置:zcode config --show"; echo ""
