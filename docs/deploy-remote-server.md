# zcode-tui 无 GUI 服务器部署指南

> 在没有图形界面的远程服务器上部署 zcode-tui，复用本机的 ZCode 登录信息。

## 前置条件

目标服务器需要：
- Linux x86_64
- Node.js 22+（推荐 24+）
- 网络能访问 `open.bigmodel.cn`（GLM API）
- ssh 访问权限

## 部署步骤

### 1. 安装 Node.js（如果服务器没有）

```bash
# 用 nvm 安装（推荐）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc
nvm install 24
node --version  # 确认 v24.x
```

或直接下载二进制：
```bash
curl -fsSL https://nodejs.org/dist/v24.15.0/node-v24.15.0-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1
```

### 2. 拷贝 zcode-tui 代码

从本机传到服务器：
```bash
# 在本机执行
scp -r /home/gaozhi/ZCodeProject/zcode-tui user@server:/home/user/ZCodeProject/zcode-tui
```

或在服务器上 clone（如果已推送到 GitHub）：
```bash
git clone git@github.com:gaozhi-ustc/zcode-tui.git ~/ZCodeProject/zcode-tui
```

安装依赖：
```bash
cd ~/ZCodeProject/zcode-tui
npm install
```

### 3. 拷贝 ZCode CLI 引擎（app-server）

zcode-tui 依赖 `/opt/ZCode/resources/glm/zcode.cjs`（9MB 的打包引擎）。

从本机传到服务器：
```bash
# 在本机执行（需要 sudo 读 /opt 下的文件）
sudo scp -r /opt/ZCode/resources/glm user@server:/tmp/glm-resources
```

在服务器上安装：
```bash
# 在服务器执行
sudo mkdir -p /opt/ZCode/resources
sudo mv /tmp/glm-resources /opt/ZCode/resources/glm
ls -la /opt/ZCode/resources/glm/zcode.cjs  # 确认存在
```

> **如果没有 sudo 权限**：修改 zcode-tui 的 `zcode-client.js` 里的 `DEFAULT_ARGS`，
> 改为引擎的实际路径（如 `~/zcode-engine/zcode.cjs`）。

### 4. 拷贝登录配置（关键！）

这是最关键的一步——服务器没有 GUI 无法登录 ZCode，需要**从本机复制配置文件**。

从本机传到服务器：
```bash
# 在本机执行
# cli config（TUI 用的，含 apiKey）
scp ~/.zcode/cli/config.json user@server:~/.zcode/cli/config.json

# 如果服务器上还没有 ~/.zcode 目录
ssh user@server "mkdir -p ~/.zcode/cli"
scp ~/.zcode/cli/config.json user@server:~/.zcode/cli/config.json
```

**config.json 结构**（手动创建也行）：
```json
{
  "model": "builtin:bigmodel-coding-plan/GLM-5.2",
  "provider": {
    "builtin:bigmodel-coding-plan": {
      "name": "Bigmodel - Coding Plan",
      "kind": "anthropic",
      "options": {
        "baseURL": "https://open.bigmodel.cn/api/anthropic",
        "apiKey": "你的API密钥"
      },
      "enabled": true,
      "source": "custom"
    }
  }
}
```

> **apiKey 获取**：从本机 `~/.zcode/cli/config.json` 或 `~/.zcode/v2/config.json`
> 里复制 `provider.options.apiKey` 字段。

### 5. 安装 wrapper 脚本

```bash
mkdir -p ~/.local/bin
cp ~/ZCodeProject/zcode-tui/src/zcode-wrapper.sh ~/.local/bin/zcode
chmod +x ~/.local/bin/zcode
```

确认 PATH 包含 `~/.local/bin`：
```bash
echo $PATH | grep local/bin
# 如果没有，加到 ~/.bashrc：
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

> **wrapper 里的 PROJECT_DIR 需要改**：如果服务器上的路径不同，
> 编辑 `~/.local/bin/zcode`，把 `PROJECT_DIR` 改为实际路径。

### 6. （可选）拷贝插件

```bash
# 在本机执行
scp -r ~/.zcode/cli/plugins user@server:~/.zcode/cli/plugins
scp ~/.zcode/cli/plugins/known_marketplaces.json user@server:~/.zcode/cli/plugins/
scp ~/.zcode/cli/plugins/installed_plugins.json user@server:~/.zcode/cli/plugins/
```

### 7. 验证

ssh 到服务器，运行：
```bash
zcode
```

应该看到：
```
ZCode  ~/current/dir  model: GLM-5.2  mode: build  ● idle
>
```

发一条消息测试：
```
> 你好
```

如果收到 GLM 的回复，部署成功。

## 快速部署脚本（一键执行）

把以下脚本在本机运行，自动完成传输：

```bash
#!/bin/bash
# deploy-zcode-tui.sh — 从本机部署 zcode-tui 到远程服务器
# 用法：./deploy-zcode-tui.sh user@server

SERVER=$1
REMOTE_DIR=${2:-~/ZCodeProject/zcode-tui}

if [ -z "$SERVER" ]; then
  echo "用法: $0 user@server [远程目录]"
  exit 1
fi

echo "=== 1. 传输 zcode-tui 代码 ==="
ssh $SERVER "mkdir -p $(dirname $REMOTE_DIR)"
scp -r /home/gaozhi/ZCodeProject/zcode-tui $SERVER:$REMOTE_DIR

echo "=== 2. 传输 ZCode CLI 引擎 ==="
ssh $SERVER "mkdir -p ~/.zcode-engine"
sudo scp /opt/ZCode/resources/glm/zcode.cjs $SERVER:~/.zcode-engine/zcode.cjs

echo "=== 3. 传输登录配置 ==="
ssh $SERVER "mkdir -p ~/.zcode/cli"
scp ~/.zcode/cli/config.json $SERVER:~/.zcode/cli/config.json

echo "=== 4. 传输插件（可选）==="
scp -r ~/.zcode/cli/plugins $SERVER:~/.zcode/cli/plugins 2>/dev/null || true

echo "=== 5. 远程安装 ==="
ssh $SERVER "cd $REMOTE_DIR && npm install && \
  mkdir -p ~/.local/bin && \
  sed 's|/home/gaozhi/ZCodeProject/zcode-tui|$REMOTE_DIR|' src/zcode-wrapper.sh > ~/.local/bin/zcode && \
  chmod +x ~/.local/bin/zcode && \
  sed -i \"s|/opt/ZCode/resources/glm/zcode.cjs|~/.zcode-engine/zcode.cjs|\" src/zcode-client.js && \
  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc"

echo "=== 完成！==="
echo "ssh $SERVER 后运行 zcode 验证"
```

## 故障排查

| 问题 | 解决 |
|------|------|
| `Model config is missing` | `~/.zcode/cli/config.json` 不存在或格式错误 |
| `missing baseURL/apiKey` | config.json 里 provider.options 缺字段 |
| `app-server spawn failed` | `/opt/ZCode/resources/glm/zcode.cjs` 不存在，或路径不对 |
| `终端渲染错乱` | 确认 `TERM` 不是 dumb；推荐 xterm-256color |
| `无法连接 API` | 检查服务器网络能否访问 `open.bigmodel.cn` |
| `EACCES` 权限错误 | `chmod +x ~/.local/bin/zcode` |

## 安全注意事项

- **apiKey 是敏感信息**：`config.json` 含明文 apiKey，传输用 scp（加密），不要用 HTTP
- **限制文件权限**：`chmod 600 ~/.zcode/cli/config.json`
- **不要把 apiKey 提交到 git**：`.gitignore` 已包含
- **退出时显示 session ID**：方便 resume，但不要泄露给不信任的人
