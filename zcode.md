# zcode-tui 实现文档

> 供其他开发者参考的架构、实现细节和开发指南。

## 1. 项目概述

**zcode-tui** 是一个基于 [Ink](https://github.com/vadimdemedes/ink)（React for CLI）的终端 UI 前端，通过 `app-server` 协议接入 ZCode CLI 引擎的全部 agent 能力（LLM 调用、工具执行、任务规划），专为 ssh 远程终端使用设计。

### 核心设计原则

- **前端职责单一**：zcode-tui 只做渲染与交互，所有 agent 逻辑（LLM 调用、工具执行、任务规划）委托给 `app-server` 子进程。
- **协议契约稳定**：通过 JSON-RPC method 与后端通信，后端升级时 method 表是契约，前端无需跟着改。
- **对标 Claude Code**：展示和交互体验像素级模仿 Claude Code。

### 技术栈

| 项 | 约定 |
|---|---|
| UI 框架 | Ink 7 + React 19 |
| 运行时 | Node.js 22+ |
| Markdown 渲染 | marked（lexer）+ chalk（ANSI 着色）+ cli-highlight（代码高亮）|
| 测试 | Vitest + ink-testing-library |
| 模块系统 | ESM（`"type": "module"`）|

## 2. 目录结构

```
zcode-tui/
├── src/
│   ├── main.js                    # 主入口：参数解析、会话创建/恢复、TUI 渲染
│   ├── zcode-client.js            # app-server 协议客户端（JSON-RPC over stdio）
│   ├── setup-cli-config.js        # 从 GUI v2 config 桥接生成 CLI config
│   ├── build-runtime-model.js     # 构造 runtimeModel（清除 resume restoreWarning）
│   └── tui/
│       ├── App.js                 # 顶层组件（渲染编排 + 按键 + 斜杠命令）
│       ├── useSessionEvents.js    # 事件管理 hook（消息/状态/权限/提问/turn）
│       ├── MessageList.js         # 消息列表（Markdown 渲染 + 窗口截取）
│       ├── InputBox.js            # 增强输入框（多行 + 历史 + @ 补全）
│       ├── StatusBar.js           # 状态栏（模型/模式/turn/token/workspace）
│       ├── keybindings.js         # 按键标识工具函数（keyToKeystroke）
│       ├── components/
│       │   ├── Spinner.js         # 加载指示器（旋转动画 + 耗时 + token + stalled）
│       │   ├── ToolUse.js         # 工具调用展示（名称/参数/diff/结果折叠）
│       │   ├── PermissionDialog.js # 权限确认对话框（y/a/n）
│       │   ├── QuestionDialog.js  # AskUserQuestion 提问对话框
│       │   ├── ModelPicker.js     # 模型选择面板
│       │   └── PluginManager.js   # 插件管理面板（启用/禁用/卸载）
│       └── markdown/
│           ├── Markdown.js        # Markdown 渲染组件 + StreamingMarkdown
│           ├── Ansi.js            # ANSI 转义码 → styled <Text> 树
│           ├── format-token.js    # marked token → ANSI 着色字符串
│           ├── MarkdownTable.js   # box-drawing 表格渲染
│           └── string-width.js    # CJK/emoji 显示宽度计算
├── test/
│   ├── zcode-client.test.js       # 协议客户端测试（8）
│   ├── setup-cli-config.test.js   # 配置桥接测试（4）
│   ├── tui/
│   │   ├── App.test.js            # App 组件测试（11）
│   │   ├── components.test.js     # 组件 + parseEvent 测试（14）
│   │   ├── markdown.test.js       # Markdown 渲染测试（18）
│   │   ├── keybindings.test.js    # 按键识别测试（10）
│   │   └── spinner.test.js        # Spinner 格式化测试（7）
├── AGENTS.md                      # 项目约束（对标 Claude Code 硬性目标）
├── docs/
│   ├── roadmap-claude-code-parity.md  # 六阶段对标路线图
│   └── superpowers/                   # 设计文档与计划
└── package.json
```

## 3. 架构与数据流

### 整体架构

```
用户终端
  ↓ ssh
  zcode-wrapper.sh
  ↓ exec node src/main.js
  ┌──────────────────────────────────────────┐
  │            main.js                        │
  │  1. ensureCliConfig()                     │
  │  2. new ZCodeClient() → connect()         │
  │  3. createSession / resumeSession         │
  │  4. subscribe(sessionId)                  │
  │  5. render(<App client sessionId />)      │
  └──────────────────────────────────────────┘
         │ stdin (JSON-RPC 请求)
         │ stdout (JSON-RPC 响应 + 事件)
         ↓
  ┌──────────────────────────────────────────┐
  │     app-server (zcode.cjs)                │
  │  • LLM 调用（GLM-5.2 等）                 │
  │  • 工具执行（Bash/Read/Write/Edit/...）   │
  │  • 任务规划 / agent loop                   │
  │  • 权限管理                                │
  └──────────────────────────────────────────┘
```

### 事件流（核心数据流）

```
用户输入 → InputBox → App.handleSubmit
  → client.sendMessage(sessionId, content)
    → app-server 处理 → 流式产出事件
      → session/event 推送（每行一个 JSON）
        → client._onLine → parseEvent → useSessionEvents.handleEvent
          → setMessages / setStatus / setPermissionQueue / ...
            → React 重渲染 → ink 输出到终端
```

### 事件类型（实机抓包确认，2026-07-16）

app-server 的 `session/event` 用 `params.type`（点号分隔）标识事件类型，`payload` 在 `params.payload`：

| params.type | payload.kind | 解析为 | 说明 |
|---|---|---|---|
| `turn.started` | - | `turn-start` | turn 开始 |
| `turn.completed` | - | `turn-complete` | turn 结束（含 usage/duration） |
| `model.streaming` | `text_delta` | `text` | 文本增量（`payload.delta`） |
| `model.streaming` | `reasoning_start/delta/end` | `reasoning-*` | 推理过程 |
| `model.streaming` | `tool_call` | `tool-call` | 工具调用（含完整 input） |
| `model.streaming` | `tool_input_start/delta/end` | `tool-call` / 忽略 | 工具输入流式 |
| `tool.updated` | `scheduled` | `tool-call` | 工具排队 |
| `tool.updated` | `started` | `tool-call` | 工具开始执行 |
| `tool.updated` | `result` | `tool-result` | 工具结果 |
| `tool.updated` | `batch` | `tool-batch-complete` | 批量完成 |
| `session.updated` | -（含 usage） | `usage` | token 统计 |
| `session.updated` | -（含 model） | `session-model` | 模型信息更新 |
| `session.titleUpdated` | - | `title-updated` | 会话标题更新 |
| `state.updated` | - | `state` | 状态补丁 |

### 权限/提问（server-request）

权限和提问不是 notification，而是 **server 发起的 RPC 请求**（server 是 caller）：

```
server → client: {id: N, method: "interaction/requestPermission", params: {toolName, input, ...}}
client → server: {id: N, result: {decision: "allow"|"deny", permissionUpdates?: [{type:"addRules",...}]}}
```

`_onLine` 区分三种消息：
1. **client 请求的响应**（id 在 `_pending`，有 result/error）
2. **server 发起的请求**（有 id + method）→ `emit('server-request')`
3. **notification**（无 id，有 method）→ `emit('event')`

## 4. 关键实现细节

### 4.1 流式增量合并

问题：`model.streaming` 的 `text_delta` 每次只含增量片段，需要合并到同一条 assistant 消息。

解决：用 `assistantMessageId` 匹配——同 id 的增量追加到已有消息的 `text` 字段，而非新建一行。

```js
// useSessionEvents.js → mergeTextDelta
const idx = prev.findIndex(m => m.mid === evt.assistantMessageId);
if (idx !== -1) {
  updated[idx] = { ...updated[idx], text: (updated[idx].text || '') + evt.text };
}
```

### 4.2 Markdown 渲染管线

对齐 Claude Code 的混合管线：

```
marked.lexer(content) → tokens
  ├─ table → <MarkdownTable>（box-drawing 列布局）
  └─ 其他  → formatToken() → chalk ANSI 字符串 → <Ansi> → <Text> 树
```

- **formatToken**：每种 token 类型（heading/paragraph/code/list/blockquote/...）转成 ANSI 着色字符串
- **Ansi 组件**：解析 ANSI SGR 转义码（颜色/bold/dim/italic/underline）→ ink `<Text>` 树
- **StreamingMarkdown**：在最后一个顶层块边界切分，稳定前缀 memoized（不重解析），只重解析增长中的后缀
- **token 缓存**：LRU（max 500），滚动回看旧消息不重复 lexer

### 4.3 Spinner（加载指示器）

对齐 Claude Code `SpinnerAnimationRow`：

- **旋转字符**：`['·','✢','✳','✶','✻','✽']` 往返动画
- **有输出/工具时固定** `✳`（不旋转，避免闪烁），纯等待时才旋转
- **耗时**：`formatDuration`（<60s → `12s`，>60s → `2m 15s`）
- **token**：优先 `usage.outputTokens`，降级 `responseLength/4`，30 秒后显示
- **stalled 检测**：30 秒无新 token → 渐变变红 + ⚠ 标识
- **工具名优先**：`currentToolName` 传入时动词替换为工具名（如 `Bash…`）

### 4.4 权限系统

- **三层防重复**：入队去重（同 rpcId 不重复加入）+ 响应去重（`respondedRpcIdsRef`）+ 按键去重（`decidedRef`）
- **"本工具总允许"**：`permissionUpdates: [{type:"addRules", behavior:"allow", rules:[{toolName, ruleContent}]}]`
- **ruleContent**：从 input 按 `command/url/file_path/path/pattern` 优先级取值

### 4.5 resume 与 restoreWarning

app-server resume 后如果旧模型不可用，会设 `restoreWarning` 阻塞 `session/send`。

解决：`buildRuntimeModel` 从 `~/.zcode/cli/config.json` 读 provider baseURL/apiKey + 从 `workspace/readState` 读 modelCatalog，构造完整 `runtimeModel`（`y_` 类型）。首条消息带 `runtimeModel` 参数触发 `GA → lvt → restoreWarning = void 0`。

### 4.6 输入框

- **多行**：Shift+Enter / Meta+Enter 换行，Enter 提交
- **历史**：↑↓ 翻历史，持久化到 `~/.zcode/tui-history`（max 200）
- **@ 补全**：输入 `@` 后文件路径补全，Tab 接受
- **光标**：←→↑↓ 跨行，Ctrl+A/E 行首尾

### 4.7 按键隔离

ink 的 `useInput` 默认所有注册的 handler 都收到按键。用 `isActive` 参数实现排他：

```js
useInput(handler, { isActive: !dialogActive });
```

对话框打开时停用 App 和 MessageList 的 useInput，只有对话框消费按键。

## 5. app-server 协议参考

### 客户端可调用的 method

| method | 参数 | 用途 |
|---|---|---|
| `session/create` | `{workspace}` | 创建会话 |
| `session/resume` | `{sessionId}` | 恢复会话 |
| `session/subscribe` | `{sessionId, deliveryKind}` | 订阅事件流 |
| `session/send` | `{sessionId, content, runtimeModel?}` | 发送消息 |
| `session/stop` | `{sessionId}` | 中断当前 turn |
| `session/setModel` | `{sessionId, model:{providerId,modelId}} ` | 切换模型 |
| `session/setMode` | `{sessionId, mode}` | 切换权限模式 |
| `session/setThoughtLevel` | `{sessionId, thoughtLevel}` | 设置思考深度 |
| `session/compact` | `{sessionId}` | 压缩上下文 |
| `session/list` | `{}` | 列出所有会话 |
| `session/read` | `{sessionId}` | 读取会话（消息/projection/runtime） |
| `workspace/readState` | `{workspace}` | 读取状态（modelCatalog/settings） |
| `plugins/list` | `{workspace}` | 列出已安装插件 |
| `plugins/install` | `{workspace, pluginName, marketplace}` | 安装插件 |
| `plugins/setEnabled` | `{workspace, pluginId, enabled}` | 启用/禁用插件 |
| `plugins/uninstall` | `{workspace, pluginId}` | 卸载插件 |
| `plugins/marketplace/add` | `{workspace, source}` | 添加 marketplace（source="owner/repo"） |

### server 可推送的请求

| method | 说明 |
|---|---|
| `interaction/requestPermission` | 权限请求（server 是 caller，client 用 {id,result} 回复） |
| `interaction/requestUserInput` | 用户提问（AskUserQuestion） |

## 6. 斜杠命令

| 命令 | 说明 |
|---|---|
| `/model [名称]` | 切换或选择模型（无参数弹出选择面板） |
| `/mode <模式>` | 切换权限模式 |
| `/think <level>` | 设置思考深度（none/low/medium/high） |
| `/compact` | 压缩对话上下文 |
| `/clear` | 清空对话 |
| `/plugins` | 插件管理面板 |
| `/sessions` | 列出历史会话 |
| `/help` | 显示帮助 |
| `/quit` | 退出 |

## 7. 快捷键

| 按键 | 作用 |
|---|---|
| `Ctrl+C` | 中断当前 turn / 双击退出 |
| `Esc` | 中断当前 turn |
| `Ctrl+O` | 展开/折叠思考过程（reasoning） |
| `PageUp/Down` | 翻看历史消息 |
| `Shift+Enter` | 多行输入换行 |
| `↑/↓` | 输入历史导航 |
| `Tab` | 接受 @ 文件补全 |

## 8. 启动与使用

### 安装

```bash
cd /home/gaozhi/ZCodeProject
npm install
mkdir -p ~/.local/bin
cp src/zcode-wrapper.sh ~/.local/bin/zcode
chmod +x ~/.local/bin/zcode
```

### 使用

```bash
zcode                      # 新会话（GUI 模式）
zcode --nogui              # 无头模式
zcode resume               # 恢复最近会话
zcode --resume <sessionId> # 恢复指定会话
zcode /path/to/project     # 指定 workspace
```

### 逃生舱

```bash
ZCODE_CLI_LEGACY=1 zcode   # 绕过 TUI，直接用原生 CLI
```

## 9. 开发指南

### 跑测试

```bash
npm test          # 全量测试
npm run test:watch # 监听模式
```

### 新增事件类型

1. 在 `zcode-client.js` 的 `parseEvent` switch 里加 `case`
2. 在 `useSessionEvents.js` 的 `handleEvent` 里加处理分支
3. 在 `test/tui/components.test.js` 加测试

### 新增斜杠命令

1. 在 `App.js` 的 `handleSlashCommand` switch 里加 `case`
2. 在 `/help` 的 `showHelp` 里加说明

### 新增组件

1. 在 `src/tui/components/` 创建组件文件
2. 用 `React.memo` 包裹（避免不必要重渲染）
3. 在 App.js 的交互层三元里加渲染分支（优先级从高到低）

### 性能注意事项

- **避免闪烁**：Spinner 有输出时固定字符不旋转；ToolUse blink 1200ms；MessageList 用 memo
- **流式输出**：用 `StreamingMarkdown`（不是 `Markdown`）渲染进行中的 assistant 消息
- **长对话**：MessageList 窗口截取（MAX_MESSAGES），ink 的 flexShrink 裁剪溢出

## 10. 六阶段对标路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| 一 | 基础正确性（增量合并/turn生命周期/Ctrl+C中断/滚动） | ✅ |
| 二 | Markdown 富文本渲染（lexer+Ansi+表格+流式+高亮） | ✅ |
| 三 | 工具调用与权限交互（展示/权限对话框/AskUserQuestion） | ✅ |
| 四 | 输入增强（多行/历史/@补全/斜杠命令） | ✅ |
| 五 | 按键绑定系统（工具函数保留，Provider 已移除） | ✅ |
| 六 | 状态与会话（StatusBar增强/resume/退出ID） | ✅ |

## 11. 已知限制

- **reasoning 依赖模型**：GLM-5.2 默认 thoughtLevel=none 不推送 reasoning，需 `/think medium` 启用
- **虚拟滚动简化**：按消息条数截取而非像素级虚拟化，超长 Markdown 可能溢出
- **shimmer 流光**：ink 的 Text 不支持 RGB 插值，用 bold 近似
- **无 Vi 模式**：InputBox 不支持 Vim 键绑定
