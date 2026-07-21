# zcode-tui 安装手册

> 适用于无 GUI 的 Linux 服务器（ssh 远程、容器、CI 等）。

---

## 方式一：root 为所有用户安装（系统级）

适合运维在服务器上一次性安装，所有用户共享。

### 1. 一键安装

```bash
sudo bash <(curl -fsSL https://raw.githubusercontent.com/gaozhi-ustc/zcode-tui/master/install.sh)
```

或下载后运行：

```bash
curl -fsSL -o /tmp/install.sh https://raw.githubusercontent.com/gaozhi-ustc/zcode-tui/master/install.sh
sudo bash /tmp/install.sh
```

> **注意**：默认装到执行用户的 `$HOME`。root 执行会装到 `/root` 下。
> 如需装到公共目录，指定环境变量：
> ```bash
> sudo ZCODE_TUI_DIR=/opt/zcode-tui bash /tmp/install.sh
> ```

### 2. 手动分步安装（root 精细控制）

```bash
# ① 安装 Node.js 24 到系统路径
curl -fsSL https://nodejs.org/dist/v24.15.0/node-v24.15.0-linux-x64.tar.xz \
  | sudo tar -xJ -C /usr/local --strip-components=1
node -v  # 确认 v24.x

# ② clone 代码到公共目录
sudo git clone https://github.com/gaozhi-ustc/zcode-tui.git /opt/zcode-tui
cd /opt/zcode-tui && sudo npm install

# ③ 安装引擎到公共目录
sudo mkdir -p /opt/zcode-engine
sudo cp /opt/ZCode/resources/glm/zcode.cjs /opt/zcode-engine/zcode.cjs
# （或从其他机器 scp 过来）

# ④ 安装 wrapper 到系统 PATH
sudo cat > /usr/local/bin/zcode << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
export ZCODE_TUI_DIR="${ZCODE_TUI_DIR:-/opt/zcode-tui}"
export ZCODE_ENGINE_PATH="${ZCODE_ENGINE_PATH:-/opt/zcode-engine/zcode.cjs}"

# 子命令拦截
case "${1:-}" in
  login) echo "启动 z.ai 登录..."; exec node "$ZCODE_ENGINE_PATH" login --no-browser "${@:2}";;
  config) shift; CLI_CFG="$HOME/.zcode/cli/config.json"
    case "${1:-}" in
      --apikey) mkdir -p "$(dirname "$CLI_CFG")"
        printf '{"model":"builtin:bigmodel-coding-plan/GLM-5.2","provider":{"builtin:bigmodel-coding-plan":{"name":"Bigmodel","kind":"anthropic","options":{"baseURL":"https://open.bigmodel.cn/api/anthropic","apiKey":"%s"},"enabled":true}}}' "$2" > "$CLI_CFG"
        chmod 600 "$CLI_CFG"; echo "✓ 配置已写入 $CLI_CFG";;
      --show) [ -f "$CLI_CFG" ] && cat "$CLI_CFG" || echo "未配置";;
      *) echo "用法: zcode config --apikey <key> | --show";;
    esac; exit 0;;
esac

[ "${ZCODE_CLI_LEGACY:-0}" = "1" ] && exec node "$ZCODE_ENGINE_PATH" "$@"
if [ ! -t 0 ] || [ "${TERM:-}" = "dumb" ]; then
  echo "终端不支持 TUI。用: node $ZCODE_ENGINE_PATH -p \"问题\"" >&2; exit 1; fi
exec node "$ZCODE_TUI_DIR/src/main.js" "$@"
EOF
sudo chmod +x /usr/local/bin/zcode
```

### 3. 每个用户各自配置认证

root 安装的是代码和引擎，**认证配置是每个用户私有的**：

```bash
# 用户各自运行（写入各自的 ~/.zcode/cli/config.json）
zcode login                    # 浏览器登录
# 或
zcode config --apikey <key>    # API Key
```

> 认证文件 `~/.zcode/cli/config.json` 权限自动设为 600（仅所有者可读写）。

---

## 方式二：普通用户为自己安装（用户级）

适合开发者在自己的家目录下安装，不需要 root 权限。

### 1. 一键安装

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/gaozhi-ustc/zcode-tui/master/install.sh)
```

脚本会自动安装到 `~/zcode-tui`，引擎到 `~/.local/share/zcode/`，命令到 `~/.local/bin/zcode`。

### 2. 手动分步安装

```bash
# ① Node.js（如果没有，用 nvm 装到用户目录，不需要 root）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc
nvm install 24

# ② clone + 依赖
git clone https://github.com/gaozhi-ustc/zcode-tui.git ~/zcode-tui
cd ~/zcode-tui && npm install

# ③ 引擎（从已装 GUI 的机器复制，或让管理员放到公共路径）
mkdir -p ~/.local/share/zcode
# 在有 GUI 的机器上执行：
#   scp /opt/ZCode/resources/glm/zcode.cjs 你的用户名@服务器:~/.local/share/zcode/zcode.cjs

# ④ wrapper
mkdir -p ~/.local/bin
cp ~/zcode-tui/src/zcode-wrapper.sh ~/.local/bin/zcode
chmod +x ~/.local/bin/zcode
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc  # 如果 PATH 里没有
source ~/.bashrc

# ⑤ 认证
zcode login
# 或
zcode config --apikey xxxxxx.yyyyyy
```

### 3. 启动

```bash
zcode                    # 启动 TUI
zcode resume             # 恢复最近会话
zcode --resume <sess_id> # 恢复指定会话
```

---

## 方式三：从已配置的机器整体迁移

适合把本机的完整环境复制到新服务器。

```bash
# === 在本机执行（已装好 zcode-tui 的机器）===

TARGET=user@new-server

# 1. 代码
scp -r ~/ZCodeProject/zcode-tui $TARGET:~/zcode-tui

# 2. 引擎
scp /opt/ZCode/resources/glm/zcode.cjs $TARGET:~/.local/share/zcode/zcode.cjs

# 3. 认证配置（含 apiKey）
ssh $TARGET "mkdir -p ~/.zcode/cli"
scp ~/.zcode/cli/config.json $TARGET:~/.zcode/cli/config.json

# 4. 插件（可选）
scp -r ~/.zcode/cli/plugins $TARGET:~/.zcode/cli/plugins
```

```bash
# === 在新服务器执行 ===
cd ~/zcode-tui && npm install
mkdir -p ~/.local/bin
cp src/zcode-wrapper.sh ~/.local/bin/zcode && chmod +x ~/.local/bin/zcode
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
zcode  # 启动
```

---

## 引擎获取方式

`zcode.cjs`（约 9MB）是 ZCode CLI 的打包引擎，三种获取途径：

| 途径 | 命令 |
|---|---|
| **本机 GUI 安装目录** | `/opt/ZCode/resources/glm/zcode.cjs` |
| **从已装机器 scp** | `scp /opt/ZCode/resources/glm/zcode.cjs target:~/.local/share/zcode/` |
| **管理员放到公共路径** | `/opt/zcode-engine/zcode.cjs`（设 `ZCODE_ENGINE_PATH` 指向） |

引擎路径查找优先级（自动）：
```
$ZCODE_ENGINE_PATH → ~/.local/share/zcode/zcode.cjs → /opt/ZCode/resources/glm/zcode.cjs
```

---

## 认证方式详解

### 方式 A：浏览器登录 z.ai（推荐）

```bash
zcode login
```

- **device-code 模式**：打印一个 URL，在任何有浏览器的设备（手机/另一台电脑）打开
- CLI 自动轮询（最长 5 分钟），登录成功后自动写入配置
- **无需服务器有 GUI 或浏览器**

### 方式 B：API Key

```bash
zcode config --apikey <apiKey>.<secretKey>
```

- 从 [Bigmodel 控制台](https://open.bigmodel.cn/console/apikey) 获取 API Key
- 格式是 `<apiKey>.<secretKey>`（用点连接）
- 直接写入 `~/.zcode/cli/config.json`

查看当前配置（脱敏）：

```bash
zcode config --show
```

### 方式 C：从本机复制配置

```bash
scp ~/.zcode/cli/config.json user@server:~/.zcode/cli/config.json
```

---

## 验证安装

```bash
# 检查各组件
which zcode                          # wrapper 位置
node -v                              # Node.js 版本 ≥22
ls ~/.local/share/zcode/zcode.cjs    # 引擎（或 /opt/ZCode/...）
zcode config --show                  # 认证配置（脱敏）

# 连通性测试（单次模式，不进 TUI）
ZCODE_CLI_LEGACY=1 zcode -p "你好"
# 如果收到 GLM 回复，说明认证和引擎都正常

# 启动 TUI
zcode
```

---

## 故障排查

| 问题 | 原因 | 解决 |
|---|---|---|
| `zcode: command not found` | PATH 未含 ~/.local/bin | `source ~/.bashrc` 或 `export PATH="$HOME/.local/bin:$PATH"` |
| `Cannot find module` / spawn 失败 | 引擎路径不对 | `ls ~/.local/share/zcode/zcode.cjs` 或设置 `ZCODE_ENGINE_PATH` |
| `配置缺失` | 未认证 | `zcode login` 或 `zcode config --apikey <key>` |
| `Model provider is missing an API key` | config.json 里 apiKey 为空 | `zcode config --show` 检查，重新 `zcode config --apikey` |
| 终端渲染错乱 | TERM 不支持 | `export TERM=xterm-256color` |
| `连接超时` | 服务器无法访问 API | `curl -s https://open.bigmodel.cn` 测试网络 |
| `EACCES` 权限错误 | wrapper 不可执行 | `chmod +x ~/.local/bin/zcode` |
| Node.js 版本不够 | 需要 22+ | `nvm install 24` |

---

## 卸载

```bash
# 用户级卸载
rm -rf ~/zcode-tui ~/.local/share/zcode ~/.local/bin/zcode
rm -rf ~/.zcode/cli          # 删除认证配置（谨慎）

# 系统级卸载（root）
rm -rf /opt/zcode-tui /opt/zcode-engine /usr/local/bin/zcode
```
