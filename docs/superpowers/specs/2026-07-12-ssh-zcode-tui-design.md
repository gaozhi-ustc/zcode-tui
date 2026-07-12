# ssh 可用的 zcode tui 转接器 — 设计文档

> 日期: 2026-07-12
> 状态: 待批准(已根据 systematic-debugging 实测结果重写)

## 背景与目标

用户希望从远程通过 ssh 连入服务器后,在纯命令行终端里使用 ZCode 的完整 agent 能力(LLM 调用、工具调用、任务规划)。

## 关键探查结论(决定方案的根本事实)

通过 systematic-debugging 实测,确认了以下事实:

### 1. `/usr/bin/zcode` 是 GUI 启动器,不能用于命令行
- 指向 `/opt/ZCode/zcode`(Electron ELF 二进制)
- 在终端执行只会拉起图形界面;因单例锁存在,会转发给已运行实例后退出
- 用户实测:`DISPLAY=:1 zcode tui` 输出 Electron 日志后退出,从未进入 TUI

### 2. 真正的 CLI 引擎可独立运行
- 位于 `/opt/ZCode/resources/glm/zcode.cjs`(9MB,`#!/usr/bin/env node`)
- meta: `source: apps/zcode-cli/packages/cli/dist/zcode.cjs`,版本 0.15.2
- 可脱离 Electron 独立运行,`doctor` 通过
- **已验证:`-p` 单次提问模式完全可用**,返回正确 LLM 响应

### 3. `tui` 子命令不可用 —— `@zcode/tui` 包本机缺失
- 运行 `zcode.cjs tui` 报 `Cannot find package '@zcode/tui'`
- 全盘搜索确认:asar 内无 `@zcode` 目录,`app.asar.unpacked/node_modules` 仅有 `@lydell`/`node-pty`/`ssh2`
- 结论:此分发渠道未打包 TUI 渲染层。**因此需要自建 TUI 前端。**

### 4. `app-server` 子命令可用 —— 协议已完全摸清
- 它是 stdio JSON-RPC 风格协议服务器,可作为 TUI 前端的稳定后端接入点
- **消息格式(关键修正):无 `jsonrpc` 字段**,用 `.strict()` 校验,只接受 `{id, method, params?, trace?}`
  - 正确: `{"id":1,"method":"session/list","params":{}}`
  - 错误: 带 `jsonrpc` 字段会被 `-32600` 拒绝
- **共 52 个客户端可调用的 method**(domain/action 格式),自建 TUI 需要的核心 method:
  - `session/create` — 创建会话(params 需 `workspace:{workspaceKey, workspacePath}`)
  - `session/send` — 发送用户消息,触发 agent 执行
  - `session/subscribe` / `session/events` — 订阅流式事件(TUI 实时渲染依赖)
  - `session/list` / `session/resume` — 会话列表与恢复(断线重连)
  - `session/setModel` / `session/setMode` — 运行时切换模型/权限模式
  - `workspace/setDefaultModel` — 持久化默认模型
  - `mcp/list` / `plugins/list` — 工具与插件状态
- **server 可主动推送**给 client:`interaction/requestPermission`(工具授权)、`interaction/requestUserInput`、`prompt/enhance/result`。TUI 必须监听并响应这些。

### 5. 模型配置 schema 已破解并验证
- CLI 读 `~/.zcode/cli/config.json`(GUI 用 `~/.zcode/v2/config.json`,两者不同)
- **正确结构(已验证可用):**
  ```json
  {
    "model": "builtin:bigmodel-coding-plan/GLM-5.2",
    "provider": {
      "builtin:bigmodel-coding-plan": {
        "name": "Bigmodel - Coding Plan",
        "kind": "anthropic",
        "options": {
          "baseURL": "https://open.bigmodel.cn/api/anthropic",
          "apiKey": "<key>"
        },
        "enabled": true
      }
    }
  }
  ```
- 关键点:`model` 是 `"providerId/modelId"` 字符串(不是对象);`apiKey` 在 `provider.options` 内(不在顶层);`baseURL` 同理
- 已实测此配置下 `-p` 返回正确响应

### 6. 登录态/凭证
- OAuth token 在 `~/.zcode/v2/credentials.json`,但 `-p` 模式使用的是 config.json 里的 provider apiKey,不依赖 OAuth。两者独立。

## 目标(一句话)

用户 ssh 登录服务器后,执行 `zcode`(我们提供的命令)即进入自建的轻量终端 UI,通过 `app-server` 协议与 ZCode CLI 引擎交互,拥有与 GUI 等价的 agent 能力,断线后可恢复会话。

## 非目标(YAGNI)

- 不做远程画面/字符化桌面转发
- 不修改 `/usr/bin/zcode` 系统符号链接、不触碰 GUI 安装
- 不重写 agent 核心/工具/MCP(直接复用 app-server 提供的能力)
- 第一版不做富文本渲染(代码块高亮、markdown 表格等),纯文本流式输出即可

## 架构

```
ssh 会话 → 用户 shell
        →  zcode (本项目 wrapper,~/.local/bin/zcode)
        →  启动 TUI 前端进程 (Node)
             │
             ├── 渲染层: 终端 UI (交互式聊天界面)
             │     ├─ 输入区: 读用户键入
             │     ├─ 输出区: 流式显示 assistant 回复 / 工具调用
             │     └─ 状态栏: 模型 / 模式 / 会话id
             │
             └── 协议层: ZCodeClient (spawn app-server, JSON-RPC over stdin/stdout)
                   ├─ session/create → 建会话
                   ├─ session/send + subscribe → 发消息并接收流式事件
                   ├─ 响应 interaction/requestPermission → 自动/手动授权
                   └─ session/resume → 断线恢复
```

### 为什么自建 TUI 而非用现成终端 UI 库直接包

因为 `@zcode/tui`(官方 TUI 包)本机不存在。我们用 Node 终端 UI 库(ink 或 blessed)自建一个**只做渲染和输入**的薄前端,所有 agent 逻辑全部委托给 `app-server`。这样:
- 不重造 agent 核心(复用 CLI 引擎的全部能力)
- 前端职责单一:渲染事件流 + 转发用户输入
- 后端升级时协议稳定(method 表是契约),前端无需跟着改

## 组件

### 组件 1: 配置桥接 `scripts/setup-cli-config.sh`

**职责:** 生成正确的 `~/.zcode/cli/config.json`,从 v2 config 提取 provider 并转换 schema。

**为什么需要:** CLI 独立运行时读 cli/config.json,而 GUI 配置在 v2/config.json,两者 schema 不同(model 字符串 vs 对象、apiKey 位置)。需要一次性桥接。

**行为:**
- 读 `~/.zcode/v2/config.json` 的 provider 块
- 提取第一个 `enabled: true` 的 provider,构造 `{model: "providerId/modelId", provider: {...}}`
- 幂等:若 cli/config.json 已有正确 model 字段则跳过
- 写入 `~/.zcode/cli/config.json`

**依赖:** `node`(解析/生成 JSON)

### 组件 2: 协议客户端 `src/zcode-client.js`

**职责:** 封装 app-server 的 JSON-RPC 通信。

**接口(对外暴露):**
- `connect(workspacePath)` — spawn app-server 子进程,完成握手
- `createSession(workspace)` → sessionId
- `sendMessage(sessionId, text, onEvent)` — 发消息,通过 onEvent 回调流式推送事件
- `respondPermission(requestId, decision)` — 响应工具授权请求
- `listSessions()` / `resumeSession(id)` — 会话管理
- `disconnect()`

**依赖:** Node `child_process`、`readline`(逐行解析 stdout)

**关键实现点:**
- 每行一个 JSON 消息(app-server 按行读写 stdio)
- 自增 id,维护 `pending: Map<id, {resolve, reject}>` 匹配响应
- server 主动推送(无 id 或 id 为 notification)走单独事件回调
- 子进程异常退出时 reject 所有 pending

### 组件 3: TUI 渲染层 `src/tui.js`

**职责:** 终端交互界面。

**技术选型:ink**(React for CLI)——理由:Node 生态最成熟的终端 UI 库,声明式渲染流式数据自然,处理键盘输入简单。备选 blessed(更重,功能全)。

**界面布局(第一版,极简):**
```
┌─ ZCode CLI (sess_xxx) ─ model: GLM-5.2  mode: build ─┐
│                                                        │
│  user: 帮我看下这个项目结构                            │
│                                                        │
│  assistant: 我来读取目录...                            │
│  [tool] Bash: ls -la                                   │
│  [tool] Read: package.json                             │
│  这个项目是一个...                                     │
│                                                        │
│  > _                                                   │
│                                                        │
│  [/] commands  [Ctrl+C] quit  [↑↓] history            │
└────────────────────────────────────────────────────────┘
```

**输入:**
- 文本输入(回车发送)
- `/` 开头:斜杠命令透传(`/model`, `/mode`, `/compact` 等映射到对应 method)
- `Ctrl+C`:中断当前 turn(session/stop)或退出
- `Ctrl+D`:退出

**输出(消费 session 事件):**
- assistant 文本增量:实时 append
- tool_call 开始/结束:显示 `[tool] <name>: <args摘要>`
- tool_result:折叠或简显
- error:红色显示
- permission 请求:提示用户 y/n,或按 mode 自动决策

### 组件 4: 入口 wrapper `src/zcode-wrapper.sh`(安装到 `~/.local/bin/zcode`)

**职责:** 把 `zcode` 命令路由到自建 TUI。

**行为:**
- 若 `TERM=dumb` 或非 TTY:降级提示用 `node zcode.cjs -p "问题"`(单次模式),不启动 TUI
- 若 `ZCODE_CLI_LEGACY=1` 环境变量:透传到原始 `zcode.cjs`(逃生舱,保留直接用 CLI 的能力)
- 否则:`exec node <项目>/src/main.js "$@"`,cwd 设为当前目录

### 组件 5: 主入口 `src/main.js`

**职责:** 串联组件 2+3。
- 解析 cwd(默认当前目录)
- 运行 setup-cli-config(确保配置就绪)
- `zcodeClient.connect()` → `createSession()`
- 挂载 TUI,把用户输入 → `sendMessage`,把事件 → TUI 渲染
- 处理 Ctrl+C / 退出 → `disconnect()`

## 数据流

1. 用户 ssh 登录,`zcode` 命令 → wrapper → `main.js`
2. main.js 确保 cli/config.json 就绪 → spawn app-server
3. `session/create` 建会话 → TUI 显示就绪
4. 用户键入回车 → `session/send` → app-server 驱动 agent loop
5. agent 流式产出:文本增量、tool_call、tool_result → 通过 `session/events` 推送 → TUI 实时渲染
6. 遇到 `interaction/requestPermission` → TUI 提示或自动授权 → 回传决策
7. turn 结束 → 回到输入态
8. 断线重连 → `session/list` → `session/resume <id>`

## 错误处理

| 场景 | 处理 |
|---|---|
| cli/config.json 缺失或 schema 错 | 自动运行 setup 脚本;仍失败则报明确指引 |
| app-server 启动失败 | 报错 + 显示 stderr 尾部 |
| `@zcode/tui` 缺失 | 不影响(我们不用它);doctor 警告可忽略 |
| TERM=dumb / 非 TTY | wrapper 降级提示用 `-p` 模式 |
| 模型 API key 失效 | 捕获 `-32603` + AiSdkModelAdapterError,提示重跑 setup 或检查 v2 config |
| app-server 子进程崩溃 | reject pending,TUI 显示错误,提供重启选项 |

## 测试策略(TDD)

- **协议客户端(组件2):** 单元测试最高价值。用模拟 app-server(一个吐预设 JSON 行的脚本)验证:消息 id 匹配、流式事件回调、permission 响应、错误传播、子进程崩溃处理。
- **配置桥接(组件1):** 测试从样例 v2 config 正确生成 cli config;幂等性。
- **TUI(组件3):** ink 提供 test renderer,可验证渲染输出。重点测:事件→渲染映射、输入→sendMessage 调用、斜杠命令路由。
- **集成冒烟(手动):** 在真实 ssh 会话跑完整流程,确认能对话、能触发工具、能恢复会话。

## 文件清单

| 路径 | 动作 | 职责 |
|---|---|---|
| `package.json` | 创建 | 项目元数据,依赖 ink 等 |
| `scripts/setup-cli-config.js` | 创建 | 配置桥接(组件1) |
| `src/zcode-client.js` | 创建 | app-server 协议客户端(组件2) |
| `src/tui.js` | 创建 | ink TUI 渲染层(组件3) |
| `src/main.js` | 创建 | 主入口(组件5) |
| `src/zcode-wrapper.sh` | 创建 | wrapper 源(安装到 ~/.local/bin/zcode) |
| `test/zcode-client.test.js` | 创建 | 协议客户端测试 |
| `test/setup-config.test.js` | 创建 | 配置桥接测试 |
| `test/tui.test.js` | 创建 | TUI 渲染测试 |
| `README.md` | 创建 | 安装与使用说明 |

## 风险

- **R1: app-server 协议在 ZCode 升级后变动。** 缓解:协议 method 表是稳定契约(domain/action);wrapper 的 `ZCODE_CLI_LEGACY=1` 逃生舱可随时退回原生 CLI;README 记录升级回归测试要点。
- **R2: ink 在某些最小化 ssh 终端渲染异常。** 缓解:文档列出已知可用终端;提供 `-p` 降级方案;`TERM` 检测。
- **R3: provider apiKey 变更后 cli/config.json 过期。** 缓解:setup 脚本可重跑;main.js 启动时检测并提示。
