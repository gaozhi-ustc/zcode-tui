# zcode-ssh-tui

让 ZCode 在 ssh 终端里可用的轻量 TUI 前端。通过 `app-server` 协议复用 ZCode CLI 引擎的全部 agent 能力(LLM、工具、任务规划)。

## 前置条件

- ZCode GUI 已安装且至少登录运行过一次(用于生成 v2 config 与 apiKey)
- Node.js v18+

## 安装

```bash
cd /home/gaozhi/ZCodeProject
npm install
mkdir -p ~/.local/bin
cp src/zcode-wrapper.sh ~/.local/bin/zcode
chmod +x ~/.local/bin/zcode
```

确保 `~/.local/bin` 在 PATH 靠前位置(bash 默认满足)。

## 使用

ssh 登录后,在任意项目目录:
```bash
zcode
```
进入交互式 TUI。键入消息回车发送,`Ctrl+C` 或 `/quit` 退出。

单次模式(脚本/管道):
```bash
node /opt/ZCode/resources/glm/zcode.cjs -p "你的问题"
```

逃生舱(临时用原生 CLI,绕过 TUI):
```bash
ZCODE_CLI_LEGACY=1 zcode --help
```

## 配置说明

本工具读 `~/.zcode/cli/config.json`(与 GUI 的 `~/.zcode/v2/config.json` 独立)。首次运行自动从 v2 config 桥接生成。更换模型/provider 后删除 `~/.zcode/cli/config.json` 重跑即可重建。

## 故障排查

| 现象 | 解决 |
|---|---|
| `Model config is missing` | 运行 GUI 登录一次;或删除 `~/.zcode/cli/config.json` 重跑 |
| `missing baseURL/apiKey` | 检查 v2 config 的 provider.options 字段完整 |
| 终端渲染错乱 | 确认 TERM 不是 dumb;推荐 xterm-256color / kitty / WezTerm |
