# 工作区指令（zcode-tui 项目）

本文件是项目级指令，仅对本仓库（zcode-tui）生效。

## 核心目标（硬性约束，长期执行）

**让 zcode-tui 具备与 Claude Code 同等水平的展示与交互能力，同时保留自身通过 app-server 协议调用 GLM 模型与工具的能力。**

这是本项目的首要演进方向。所有功能开发都应朝此目标推进，直到产出阶段性成果。

### 不变的边界

- **前端职责单一**：zcode-tui 只做渲染与交互，所有 agent 逻辑（LLM 调用、工具执行、任务规划）继续委托给 app-server 子进程。**禁止在前端内嵌模型调用或工具实现。**
- **协议契约稳定**：通过 `session/send`、`session/subscribe`、`interaction/respondPermission` 等 app-server method 与后端通信。后端升级时 method 表是契约，前端无需跟着改。
- 技术栈保持：ink 7 + React 19 + Node 22+。

### Claude Code 展示交互能力的对标维度（逐步达成）

参照 `claude-code-sourcemap-main` 还原源码的机制，分阶段实现：

1. **流式增量合并**（基础正确性）：用 `assistantMessageId` 把多条 text 事件合并到同一条 assistant 消息，而非每条新增一行。
2. **Markdown + 代码高亮渲染**：marked 词法分析 + formatToken → ANSI 着色 + `<Ansi>` 组件；表格用 React 布局；代码块用 cli-highlight 懒加载高亮。
3. **流式 Markdown**：在最后一个顶层块边界切分，稳定前缀用 memoized `<Markdown>`，只重解析不稳定后缀。
4. **消息滚动**：虚拟列表 + PageUp/PageDown/滚轮翻页，避免消息无限堆叠。
5. **工具调用完整展示**：解析 tool_call/tool_result 事件，展示工具名、参数摘要、结果、可折叠，带闪烁加载指示器。
6. **输入增强**：多行输入（Shift+Enter）、输入历史（↑↓ 翻历史，分块磁盘读取）、斜杠命令（/model /mode /compact 等 fuzzy 搜索）、@ 文件提及。
7. **权限交互 UI**：工具调用时的 y/n 确认对话框（Select 组件 + Confirmation 按键上下文）。
8. **按键绑定系统**：基于上下文的按键映射（Global/Chat/Confirmation/Scroll），支持 chord（ctrl+x ctrl+k），Ctrl+C 为"先中断后退出"的基于时间双击（800ms）。
9. **状态栏增强**：模型、token 用量、成本、当前 turn 号、workspace 路径、权限模式。
10. **会话恢复**：`session/list` + `session/resume` 断线重连。

### 参考资源

- Claude Code 还原源码：`~/ZCodeProject/claude-code-sourcemap-main/restored-src/src/`
- 关键参考模块：`ink/`（渲染层）、`components/`（UI 组件）、`hooks/`（交互逻辑）、`keybindings/`（按键系统）、`state/`（状态管理）
- 设计文档：`docs/superpowers/specs/2026-07-12-ssh-zcode-tui-design.md`

## 闪烁测试

渲染层改动必须跑 `npm test`（含 `test/flicker/` 帧度量回归网）；
涉及擦除/清屏/滚动行为的改动还应跑 `npm run test:pty`。
帧数/擦除量基线在 `test/flicker/baselines/`，超 20% 即回归失败；
有意的渲染变更用 `UPDATE_BASELINES=1` 重校准。
设计文档：`docs/superpowers/specs/2026-07-17-flicker-testing-design.md`。

## Deploy 脚本

- **时区参数解析规则**：deploy 脚本的时区参数按**城市名**传入（如 `Beijing`、`Shanghai`、`New York`、`Tokyo`）。
  - **禁止直接把城市名当作时区使用**（如 `Beijing` 不是合法 IANA 时区）。
  - **必须查询 IANA 时区数据库**，将城市名解析为对应的 IANA 时区标识符（如 `Beijing` → `Asia/Shanghai`、`New York` → `America/New_York`、`Tokyo` → `Asia/Tokyo`）。
  - 解析得到的 IANA 标识符应使用 `America/New_York`、`Asia/Shanghai` 这样的 `区域/城市` 形式。
  - 若城市名无法在 IANA 数据库中唯一匹配，应报错并提示用户改用明确的 IANA 时区标识符（如 `Asia/Shanghai`）。
