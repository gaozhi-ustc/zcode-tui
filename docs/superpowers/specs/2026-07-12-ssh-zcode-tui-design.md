# ssh 可用的 zcode tui 转接器 — 设计文档

> 日期: 2026-07-12
> 状态: 待批准

## 背景与目标

用户希望从远程通过 ssh 连入服务器后,在纯命令行终端里使用 ZCode 的完整 agent 能力(LLM 调用、工具调用、任务规划)。

**关键探查结论(决定方案的根本事实):**

- `/usr/bin/zcode` 当前是符号链接,指向 `/opt/ZCode/zcode` —— 这是 **GUI 启动器(Electron)**,在终端里执行只会拉起图形界面,无法提供命令行交互。
- 真正的 CLI 引擎打包在 `/opt/ZCode/resources/glm/zcode.cjs`(9MB,`#!/usr/bin/env node`),其 meta 标注 `source: apps/zcode-cli/packages/cli/dist/zcode.cjs`,**是 ZCode 官方的独立 CLI 包**,与 GUI 共享同一套后端能力。
- 该 CLI 可脱离 Electron 独立运行:`node /opt/ZCode/resources/glm/zcode.cjs --help` 正常输出,版本 0.15.2,`doctor` 通过。
- CLI 内置 `tui`(全屏终端交互界面)、`-p`(单次提问)、`app-server`(stdio 协议)、`--resume`/`--continue`(会话恢复)、`/skill`/`/mcp`/`/expert`(技能、工具、任务规划)。
- 登录态已就绪:`~/.zcode/v2/credentials.json` 含 OAuth token,与 GUI 共享,无需重新登录。

**因此本任务不需要"从零造一个转接器"。** 真正的工作是:让 ssh 会话里的 `zcode` 命令路由到 CLI 引擎,并确保终端环境适配 TUI。

**目标(一句话):** 用户 ssh 登录服务器后,执行 `zcode` 即进入全屏终端版 ZCode,拥有与 GUI 等价的 agent 能力,断线后可恢复会话。

## 非目标(YAGNI)

- 不做远程画面/字符化桌面转发(方案一)—— 已论证在普通 ssh 终端不可用。
- 不自建独立 CLI 前端(原方案二的岔路 B)—— 官方 CLI 已满足需求。
- 不做多人共享同一会话、GUI 状态实时镜像等高级特性。
- 不修改 `/usr/bin/zcode` 系统符号链接、不触碰 GUI 安装。

## 架构

```
ssh 会话 → 用户的登录 shell (~/.bashrc 已含 ~/.local/bin 于 PATH)
         →  zcode 命令
         →  ~/.local/bin/zcode  (本项目提供的 wrapper 脚本)
         →  exec node /opt/ZCode/resources/glm/zcode.cjs "$@"
```

wrapper 透传所有参数,因此 `zcode tui`、`zcode -p "..."`、`zcode --resume <id>`、`zcode doctor` 等子命令全部原样工作。

### 为什么用 PATH 覆盖而非修改系统链接

- `~/.local/bin` 在 PATH 中位于 `/usr/bin` 之前(bash 默认),放置同名 `zcode` 即可优先命中,无需 root 权限。
- 不触碰 `/usr/bin/zcode` → GUI 从桌面菜单启动的行为完全不变。
- 卸载只需删除一个文件,零残留。

## 组件

### 组件 1: wrapper 脚本 `~/.local/bin/zcode`

**职责:** 把 `zcode` 命令路由到 CLI 引擎。

**接口:** `zcode [任何原 CLI 支持的参数]`

**依赖:** `node`(v24 已安装)、`/opt/ZCode/resources/glm/zcode.cjs`(已存在)

**行为:**
- 定位 CLI 引擎路径(优先环境变量 `ZCODE_CLI_PATH` 覆盖,默认 `/opt/ZCode/resources/glm/zcode.cjs`)
- `exec node "$ZCODE_CLI" "$@"`,用 exec 替换进程,保证信号/退出码正确透传
- 若引擎文件不存在,打印明确错误而非静默失败

### 组件 2: ssh 终端环境适配

**职责:** 确保 TUI 在 ssh 会话里能正确渲染。

**关键事实:** TUI 需要真终端。`TERM=dumb`(当前 ssh agent 执行环境的值)无法渲染。但真实交互式 ssh 登录的 `TERM` 通常是 `xterm-256color`,可用。因此:
- 不在 wrapper 里强行设置 `TERM`(强行改可能破坏其他程序)
- wrapper 检测到 `TERM=dumb` 或非 TTY 时,打印友好提示:建议改用 `zcode -p "问题"`(单次模式,不依赖全屏 TUI),或确认终端类型
- 文档说明:交互式 ssh(伪终端)下 `zcode tui` 直接可用

**locale:** 默认 `LANG=en_US.UTF-8` 已合适,无需处理。

### 组件 3(可选): 会话恢复便捷封装

**职责:** 简化断线恢复。

由于 CLI 原生支持 `--continue`/`--resume`,本组件仅提供一个语义化别名 `zcode-resume`,等同于 `zcode --continue`,降低记忆负担。属增量便利,非必需。

## 数据流

1. 用户 ssh 登录 → 交互式 bash,`~/.local/bin` 在 PATH 前列
2. 用户键入 `zcode`(无参数)→ CLI 默认行为是打开 TUI
3. wrapper `exec node zcode.cjs` → CLI 接管终端,渲染全屏 UI
4. 用户对话/使用工具 → CLI 直连 LLM(复用 GUI 的 OAuth token)
5. 断线 → 用户重连后 `zcode --continue` 恢复最近会话

## 错误处理

| 场景 | 处理 |
|---|---|
| 引擎文件不存在 | wrapper 报错并提示检查 ZCode 安装 |
| `TERM=dumb` / 非 TTY | wrapper 提示用 `zcode -p` 或换交互式终端,不强行启动 TUI |
| 未登录(credentials 缺失) | CLI 自身会引导 `zcode login`;文档补充说明 |
| node 不在 PATH | wrapper 报错提示 |

## 测试策略

- **wrapper 单元测试:** 验证参数透传、引擎路径定位、错误路径(引擎缺失时报错)。用桩模拟 node 调用。
- **集成验证(手动):** 在真实 ssh 会话执行 `zcode --version`、`zcode doctor`、`zcode -p "ping"` 确认链路通。
- **TUI 冒烟:** 在交互式 ssh 终端执行 `zcode` 进入 TUI,确认能渲染、能发一条消息。

## 文件清单

| 路径 | 动作 | 职责 |
|---|---|---|
| `~/.local/bin/zcode` | 创建 | wrapper 脚本(组件1) |
| `src/zcode-wrapper.sh` | 创建 | wrapper 源码(项目内留存,便于版本管理与重装) |
| `test/wrapper.test.sh` | 创建 | wrapper 行为测试 |
| `README.md` | 创建 | 安装与使用说明(ssh 场景) |

## 风险

- **R1: ZCode 升级后 `zcode.cjs` 路径变动。** 缓解:wrapper 支持环境变量覆盖路径;`README` 记录升级后如何修正。
- **R2: 某些 ssh 客户端终端类型 TUI 渲染异常。** 缓解:文档列出已知可用终端;提供 `-p` 降级方案。
