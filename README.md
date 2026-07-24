# zcode-tui

让 ZCode 在 ssh 终端里可用的轻量 TUI 前端。通过 `app-server` 协议复用 ZCode CLI 引擎的全部 agent 能力（LLM、工具、任务规划）。展示与交互对标 Claude Code。

## 一键安装（推荐）

在任何 Linux 服务器上（**无需 GUI**），执行：

```bash
curl -fsSL https://raw.githubusercontent.com/gaozhi-ustc/zcode-tui/master/install.sh | bash
```

脚本自动完成 6 步：

| 步骤 | 内容 |
|---|---|
| 1. Node.js | 检查 ≥22，不够则 nvm 自动安装 |
| 2. 代码 | clone 到 `~/zcode-tui` + `npm install` |
| 3. 引擎 | 自动从 [GitHub Release](https://github.com/gaozhi-ustc/zcode-tui/releases) 下载 `zcode.cjs`（~9MB） |
| 4. 命令 | 安装 `zcode` wrapper 到 `~/.local/bin/` |
| 5. 认证 | 三选一：浏览器登录 / API Key / 跳过 |
| 6. 验证 | 检查引擎、配置、命令、PATH |

安装完成后直接运行 `zcode` 即可。

## 认证配置

### 方式 A：浏览器登录 z.ai（device-code，无需 GUI）

```bash
zcode login
```

打印一个 URL，在任何有浏览器的设备（手机/另一台电脑）打开完成登录，CLI 自动轮询完成。

### 方式 B：API Key

```bash
zcode config --apikey <apiKey>.<secretKey>
```

从 [Bigmodel 控制台](https://open.bigmodel.cn/console/apikey) 获取 API Key。

### 方式 C：查看当前配置（脱敏）

```bash
zcode config --show
```

## 使用

```bash
zcode                        # 启动 TUI（新会话）
zcode resume                 # 恢复最近会话
zcode --resume <sessionId>   # 恢复指定会话
zcode /path/to/project       # 指定工作目录
```

进入 TUI 后：
- 键入消息回车发送，`Ctrl+C×2` 或 `/quit` 退出
- `/help` 查看所有命令和快捷键

### 权限模式

```bash
/mode build    # 人工审批每次权限请求（默认）
/mode auto     # LLM 智能判断，安全的自动批准
/mode yolo     # 全部自动批准（无需确认）
```

### 斜杠命令

| 命令 | 说明 |
|---|---|
| `/help` | 显示帮助 |
| `/mode <build\|auto\|yolo>` | 切换权限模式 |
| `/model [名称]` | 切换或选择模型 |
| `/think <level>` | 设置思考深度（none/low/medium/high） |
| `/plugins` | 插件管理（启用/禁用/卸载） |
| `/sessions` | 列出历史会话 |
| `/compact` | 压缩对话上下文 |
| `/clear` | 清空对话 |
| `/quit` | 退出 |

### 快捷键

| 按键 | 作用 |
|---|---|
| `Ctrl+C` / `Esc` | 中断当前任务 |
| `Ctrl+C×2` | 退出 |
| `Ctrl+O` | 展开/折叠思考过程 |
| `PageUp/Down` | 翻看历史消息 |
| `Shift+Enter` | 多行输入换行 |
| `↑/↓` | 输入历史导航 |
| `Tab` | 接受 @ 文件补全 |

## 逃生舱

```bash
ZCODE_CLI_LEGACY=1 zcode     # 绕过 TUI，直接用原生 CLI
```

## 手动安装（不用一键脚本）

```bash
git clone https://github.com/gaozhi-ustc/zcode-tui.git ~/zcode-tui
cd ~/zcode-tui && npm install
mkdir -p ~/.local/bin
cp src/zcode-wrapper.sh ~/.local/bin/zcode && chmod +x ~/.local/bin/zcode
# 安装引擎
mkdir -p ~/.local/share/zcode
curl -fsSL https://github.com/gaozhi-ustc/zcode-tui/releases/download/v0.1.0/zcode.cjs \
  -o ~/.local/share/zcode/zcode.cjs
# 认证
zcode login  或  zcode config --apikey <key>
```

## 故障排查

| 问题 | 解决 |
|---|---|
| `Cannot find module ...zcode.cjs` | 引擎未安装，运行 `curl ... install.sh \| bash` 或手动下载引擎 |
| `配置缺失` | 运行 `zcode login` 或 `zcode config --apikey <key>` |
| `zcode: command not found` | `source ~/.bashrc` 或 `export PATH="$HOME/.local/bin:$PATH"` |
| 终端渲染错乱 | `export TERM=xterm-256color` |
| Node.js 版本不够 | `nvm install 24` |

详细安装手册：[docs/install-guide.md](docs/install-guide.md)  
实现文档：[zcode.md](zcode.md)
