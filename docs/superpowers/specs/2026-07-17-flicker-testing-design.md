# zcode-tui 闪烁测试体系设计

日期：2026-07-17
状态：已获用户批准

## 目标

为 zcode-tui 建立一套**可自动化、可回归、可度量**的闪烁（flicker）测试体系，覆盖开发过程中所有已知的闪烁路径，使后续渲染层优化（对标 Claude Code）有客观的度量基准和回归保护网。

## 背景：闪烁根因

zcode-tui 使用 stock ink 7（`maxFps: 30`、无 `<Static>`、无增量渲染）。任何 React commit 都会触发 ink **整屏擦除重写**（`eraseLines(lastOutputHeight) + 全量输出`）；内容超出视口高度或终端缩宽时进一步触发 **全清**（`\x1b[2J\x1b[3J\x1b[H]`）。擦除与重写之间的渲染间隙即用户感知到的闪烁，SSH 高延迟下尤为明显。

Claude Code 使用深度 fork 的 ink：cell 双缓冲 diff + DEC 2026 同步输出 + 16ms 合帧 + 单次写入。本测试体系的度量指标（全清次数、擦除行数、稳定区违规、帧率）同时是后续向其靠拢的优化靶点。

## 已枚举的闪烁风险路径（被测对象）

| 编号 | 路径 | 位置 |
|---|---|---|
| B1 | Spinner 定时器（100ms/500ms tick）触发全屏重写 | `src/tui/components/Spinner.js:92-99` |
| B1b | 每个进行中工具独立 blink 定时器（1200ms） | `src/tui/components/ToolUse.js:7-15` |
| B2 | text_delta 无节流，每 delta 最多一次 commit（30fps 全屏重写） | `src/tui/useSessionEvents.js:59-61` |
| B2b | StreamingMarkdown 每个 delta 重解析不稳定后缀 | `src/tui/markdown/Markdown.js:119` |
| B3 | 无 `<Static>`，历史消息每帧参与布局与发射 | `src/tui/App.js:278-334` |
| B3b | 内容超高 → ink overflow → 全清 | `src/tui/MessageList.js:27-28`（按消息数而非行数截断） |
| B4 | spinner 行出现/消失、对话框替换 InputBox、@建议浮层 → 布局跳动 | `Spinner.js:101`、`App.js:288-320`、`InputBox.js:222-232` |
| B5 | cli-highlight 懒加载完成后所有已挂载 Markdown 全局重渲染（代码块闪变） | `src/tui/markdown/Markdown.js:43-53,61-69` |
| B6 | 击键 = 帧重写；@建议的 useEffect 产生额外 commit | `src/tui/InputBox.js:66-76,165-197` |
| B7 | resize：缩宽触发全清，无 debounce | ink 内建行为 + `MessageList.js:11` 每渲染读 stdout.rows |

## 架构

```
场景测试 (vitest, 默认 npm test)        PTY 测试 (npm run test:pty)
   │                                       │
   ▼                                       ▼
render-harness ──► 自定义 mock stdout       script(1) 分配 pty
（React 树 + fake timers）（frames[] + 可配     ──► node test/flicker/pty/driver.js
   │                     rows/columns +           │  ├─ ink render(App)
   │                     resize() 发射事件）       │  └─ ZCodeClient(command='node',
   │                                       │       args=[fake-app-server.js])
   ▼                                       ▼
frame-metrics 探针（frames[] → 结构化度量）  原始字节流 → 字节级断言
   │                                       （eraseLines 次数 / \x1b[2J 次数 /
   ▼                                        字节量 / 时间分布）
thresholds.js 双档阈值
（current 档全绿 = 回归网；target 档 test.fails = 优化靶点）
```

选择 POSIX `script(1)` 而非 node-pty：零新依赖、Linux 必带。PTY 测试不进默认 `npm test`，避免环境差异影响单元测试稳定性。

## 组件设计

### test/flicker/helpers/frame-metrics.js

探针。输入 `frames[]`（mock stdout 累积的每次 write 的原始字符串）与时长，输出结构化度量：

| 度量 | 定义 | 检测方式 |
|---|---|---|
| `frameCount` / `fps` | 帧数 / 帧率 | frames.length / 时长 |
| `bytesTotal` | 总写入字节 | 累加 frame.length |
| `fullClearCount` | 全清次数 | 帧中出现 `\x1b[2J` |
| `eraseLinesTotal` | 擦除行操作总量 | 帧中 `\x1b[1A` 出现次数（eraseLines 序列特征） |
| `perFrameDiffLines` | 相邻帧逐行 diff 的变化行数数组 | split('\n') 按位比较 |
| `stablePrefixViolations` | 「应稳定行」在相邻帧间被改写的次数 | 调用方给行选择器（如已完成消息文本） |
| `layoutShifts` | 帧总行数变化次数 | 相邻帧行数比较 |

### test/flicker/helpers/test-stdout.js

自定义 mock stdout/stdin（仿 ink-testing-library，因其 Stdout 的 `columns` 固定为 100 且无 `rows`）：
- `columns`/`rows` 构造可配
- `resize(cols, rows)`：修改尺寸并 emit `'resize'`
- `write` 收集到 `frames[]`
- mock stdin：`write(data)` emit `'data'`，`setRawMode`/`ref`/`unref` no-op
- 直接调用 ink 的 `render(element, {stdout, stdin, debug: true})`

### test/flicker/helpers/event-source.js

流式事件编排器，复用现有 `makeMockClient` 模式（`App.test.js` 中的 handlers + `_emit`）：

```js
makeScript(client)
  .userTurn('写个排序')
  .textDelta('好的，', { repeat: 30, everyMs: 10 })   // 突发注入
  .toolCall('Bash', { cmd: 'ls' })
  .toolResult('ok')
  .turnComplete()
  .run(timers)   // 按 fake timers 推进发射
```

### test/flicker/helpers/thresholds.js

双档阈值 + 基线快照机制：

```js
export const budgets = {
  current: { /* 按现状校准，全部通过 = 回归网 */ },
  target:  { /* aspirational，用 test.fails 标记 = 优化靶点 */ },
};
```

- 硬断言：结构性不变量（如"spinner 运行时历史区行零变化"、"无 `\x1b[2J`"），直接写在测试里
- 基线快照：数量型度量（帧数、eraseLinesTotal、字节量）存 `test/flicker/baselines/*.json`，断言 `metric ≤ baseline × 1.2`；设 `UPDATE_BASELINES=1` 环境变量时重写基线

## 场景矩阵（渲染层，7 组）

| 组 | 场景 | 操作 | 硬断言（current 档） | 基线度量 |
|---|---|---|---|---|
| S1 | spinner 空转 5s | fake timers 推进 | 无 `\x1b[2J`；稳定区行零变化 | fps、eraseLinesTotal |
| S1b | spinner 流式模式 5s | streaming + 工具进行中 | fps ≤ 12（tick 500ms + ink 30fps 上限） | 同上 |
| S1c | 3 个并行工具 blink | tool_call×3 不发 result | 帧数 ≤ 推进 tick 数对应上界 | 帧数 |
| S2 | 50 个 text_delta @10ms 突发 | 事件源注入 | 帧数 ≤ 30fps × 时长（验证 ink 合帧） | 帧数、diff 行分布 |
| S2b | markdown 流式（代码块+表格） | 同上 | 块边界前的稳定前缀行零变化 | 稳定前缀违规数 |
| S3 | 内容超高溢出 | rows=20 + 长消息流 | 末帧内容完整（无丢消息） | fullClearCount |
| S4 | resize 风暴 | 列 100→80→100→60 | 每次缩宽 ≤1 次全清；同尺寸 resize 零帧 | fullClearCount |
| S5 | cli-highlight 加载完成 | vi.mock 控制 import 时机 | 末帧代码块高亮正确 | 全局重渲染次数 |
| S6 | 布局跳动 | 权限对话框开/关、@建议出现/消失 | 跳动帧无 `\x1b[2J` | layoutShifts |
| S7 | 输入 + turn 完成 | 20 次击键、turn-complete | 每击键帧数 ≤ 2（含 useEffect 额外 commit） | 帧数 |

## PTY 层（3 个场景）

`test/flicker/pty/`：
- `driver.js`：ink render(App) + ZCodeClient 指向 fake server（利用 `ZCodeClient({command, args})` 注入点，无需改 main.js）
- `fake-app-server.js`：行分隔 JSON-RPC，按内置时间线脚本应答 session 方法并推送事件
- `run-pty.sh`：`script -qec '...' /dev/null` 包装，前置 `stty rows/cols` 设窗口尺寸

| 场景 | 操作 | 断言 |
|---|---|---|
| P1 流式突发 | 100 delta @5ms | eraseLines 总次数 ≤ 基线×1.2；`\x1b[2J` = 0 |
| P2 小窗溢出 | `stty rows 15` + 长输出 | 无死循环重写（帧间隔分布合理）；末帧内容完整 |
| P3 resize | 运行中两次 `stty cols` 变更 | 全清次数 ≤ 2 |

环境无 `script` 命令时自动 skip（`test.skipIf`）。

## 错误处理与已知坑

- vitest fake timers 需 `toFake: ['setInterval', 'setTimeout', 'Date']`，以控制 ink 的 30fps throttle（lodash throttle 读 `Date.now`）
- fake timers 下 harness 提供 `flushFrames(ms)`：advanceTimersByTime 驱动 ink throttle 帧发射
- cli-highlight 异步 import 用 `vi.mock('cli-highlight')` + 手动 flush 控制时机
- PTY 字节流分析复用 frame-metrics 的序列识别正则（抽成共享模块 `ansi-metrics.js`）
- 探索中发现的既有 bug（`/help`、`/sessions` 的 `setMessages` ReferenceError、`warmupHighlight` 死代码未调用）**不在本范围修复**，场景设计避开这些路径，另行列出报告

## 测试策略（本体系自身的质量保障）

- 探针 `frame-metrics.js` 本身配单元测试：构造手写 frames 验证各度量识别正确（尤其 `\x1b[2J` 与 eraseLines 模式）
- 基线机制测试：baseline 缺失时自动写入并 pass；超标时 fail
- 全部场景测试进默认 `npm test`（vitest），PTY 测试独立 script

## 交付物

1. 本设计文档
2. 实施计划 `docs/superpowers/plans/2026-07-17-flicker-testing.md`
3. 测试基建 4 文件 + 场景测试 7 组 + PTY 3 场景 + 基线机制
4. 差距分析报告（任务 2）
