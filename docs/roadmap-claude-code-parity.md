# Claude Code 对标路线图

目标：让 zcode-tui 具备与 Claude Code 同等水平的展示与交互能力，保留 app-server 协议架构。

对标依据：`~/ZCodeProject/claude-code-sourcemap-main/restored-src/src/`

---

## 阶段划分

### 阶段一：基础正确性（当前）

修复现有 bug，让基本对话流可用。

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 1.1 | 流式增量合并 | ⬜ | 用 assistantMessageId 合并 text 事件，而非每条新增一行 |
| 1.2 | turn 生命周期 | ⬜ | 消费 turn-start/turn-complete，正确切换 idle/running |
| 1.3 | Ctrl+C 中断 turn | ⬜ | 改为 session/stop 而非退出程序；二次 Ctrl+C 才退出 |
| 1.4 | 消息滚动（基础） | ⬜ | PageUp/PageDown 翻页，避免无限堆叠 |

### 阶段二：富文本渲染

让 assistant 回复像 Claude Code 一样渲染 Markdown。

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 2.1 | ANSI 渲染组件 | ⬜ | Ansi 组件：解析 ANSI 转义码 → styled Text 树 |
| 2.2 | Markdown 词法 + 渲染 | ⬜ | marked lexer + formatToken → ANSI 着色 |
| 2.3 | 代码块语法高亮 | ⬜ | cli-highlight 懒加载（Suspense + use） |
| 2.4 | Markdown 表格 | ⬜ | strip-ansi 测宽 + React 列布局 |
| 2.5 | 流式 Markdown | ⬜ | 块边界切分，稳定前缀 memoize |

### 阶段三：工具调用与权限交互

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 3.1 | tool_call/tool_result 事件解析 | ⬜ | parseEvent 增加工具事件类型 |
| 3.2 | 工具调用展示组件 | ⬜ | 工具名、参数摘要、结果、可折叠、闪烁加载 |
| 3.3 | 权限确认对话框 | ⬜ | Select 组件 + y/n 决策 + Confirmation 按键 |
| 3.4 | diff 预览（文件编辑） | ⬜ | 文件改动 diff 渲染 |

### 阶段四：输入增强

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 4.1 | 多行输入 | ⬜ | Shift+Enter 换行 |
| 4.2 | 输入历史 | ⬜ | ↑↓ 翻历史，分块磁盘读取 |
| 4.3 | 斜杠命令 | ⬜ | /model /mode /compact 等，fuzzy 搜索 |
| 4.4 | @ 文件提及 | ⬜ | 路径补全 |

### 阶段五：按键绑定系统

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 5.1 | 按键上下文系统 | ⬜ | Global/Chat/Confirmation/Scroll 上下文 |
| 5.2 | chord 支持 | ⬜ | 多键组合（ctrl+x ctrl+k） |
| 5.3 | Ctrl+C 双击退出 | ⬜ | 时间双击（800ms），先中断后退出 |
| 5.4 | Ctrl+O/T/L 等快捷键 | ⬜ | 切换 transcript/todos/redraw |

### 阶段六：状态与会话

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 6.1 | 状态栏增强 | ⬜ | token/成本/turn/workspace |
| 6.2 | 会话恢复 | ⬜ | session/list + session/resume |
| 6.3 | 虚拟列表 | ⬜ | 长对话虚拟滚动 |

---

## Claude Code 关键机制速查（实现时参考）

### Markdown 渲染（components/Markdown.tsx）
```
marked.lexer(content) → tokens
  ├─ table → <MarkdownTable>（React 列布局）
  └─ 其他 → formatToken(token) → ANSI 字符串 → <Ansi>
LRU token cache（hash key，max 500）
```

### 流式 Markdown（StreamingMarkdown）
```
1. stripPromptXMLTags
2. 找最后一个顶层块边界（双换行）
3. stablePrefix = 边界前 → memoized <Markdown>
4. unstableSuffix = 边界后 → 重解析 <Markdown>
'use no memo' 退出 React Compiler 缓存
```

### 输入（hooks/useTextInput.ts）
```
Enter: multiline + prev '\' → 插入换行；meta/shift → 换行；else → submit
Up/Down: cursor.up → cursor.upLogicalLine → onHistoryUp（三级回退）
```

### Ctrl+C（useExitOnCtrlCD + useDoublePress）
```
时间双击 800ms（非 chord 系统）
第一次 Ctrl+C → app:interrupt（中断 turn）
第二次（800ms 内，idle 时）→ app:exit（退出）
```

### 权限流（REPL.tsx）
```
tool_use 到达 → toolUseConfirmQueue.push(ToolUseConfirm)
→ toolPermissionOverlay 渲染 <PermissionRequest>
→ Select y/n → PermissionDecision → 执行/拒绝
overlay 激活时禁用 CancelRequestHandler，escape 归对话框
```

### 按键系统（keybindings/）
```
defaultBindings.ts: (context, keystroke) → action
resolver.ts: resolveKey（last match wins）+ chord 状态机
useKeybinding(action, handler, {context, isActive})
```
