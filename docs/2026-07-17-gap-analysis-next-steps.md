# 差距分析与下一步改进方向（2026-07-17）

依据：zcode-tui 当前实现 vs `claude-code-sourcemap-main/restored-src` 的逐项对比，
结合同日落地的闪烁测试体系实测数据（`test/flicker/baselines/`）。

## 现状判断

**展示层功能面已基本铺开**：流式增量合并、Markdown/表格/代码高亮、流式 Markdown 稳定前缀、
工具调用展示、权限对话框、多行输入、@提及、斜杠命令骨架均已实现。
**核心差距在渲染引擎层与交互细腻度**：Claude Code 用 fork 的 ink 解决了"何时重绘、重绘多少"的问题；
zcode-tui 用 stock ink，任何 setState = 整屏擦除重写。实测：spinner 空转 5.2fps 全屏重写（每帧擦 ~6 行），
40 行内容超 20 行视口即触发 1 次全清，CLI highlight 加载完成触发 1 次全局重渲染闪变。

好消息：ink 7 已自带两项 Claude Code 的关键能力——DEC 2026 同步输出（BSU/ESU，终端支持时生效）
和 `incrementalRendering` 渲染选项（默认关闭），差距比预期小。

---

## 下一步最值得改进的方向（按性价比排序）

### 方向 1：渲染层止闪（最高优先级）

目标：把"任何状态变化都整屏重写"降到"只重绘变化的部分"。三层递进，每层独立可落地、
都有刚建好的度量网（test/flicker）验证：

1. **开启 ink `incrementalRendering`（一天级 spike）**：ink 7 原生选项，行级 diff 替代整屏擦除。
   用 S1/S2/S4 基线对比开启前后的 eraseLinesTotal（预期 154 → 个位数）。风险：需验证与
   wrap-ansi、`<Ansi>` 的兼容性——测试网正好兜住。
2. **引入 `<Static>` 渲染已完成消息**：历史移出动态区后，spinner tick / 流式 delta 不再
   重排重发历史（Claude Code 靠 patch-diff 达到同等效果，我们用 stock ink 的 Static 即可）。
   对应守护：S1 的 stableLineViolations + eraseLinesTotal 基线。
3. **动画时钟收口**：Spinner/ToolUse blink 各自 setInterval → 单一共享 ClockContext
   （对齐 Claude Code），时钟组件下沉为叶子节点，父树不参与 tick 重渲染。
   对应靶点：S1-target（5.2fps → ≤2fps，test.fails 等待翻转）。

### 方向 2：流式更新应用层合帧

`useSessionEvents` 每个 text_delta 两个 setState，靠 ink 30fps throttle 被动合并（实测 50 delta → 13 帧）。
Claude Code 的做法：渲染层 16ms 合帧 + `useDeferredValue` 延迟消息列表 + 只显示到最近换行。
**落地**：在 hook 内做 16-32ms 的 delta 缓冲合并（或 React `useDeferredValue`），
把 S2-target（≤10 帧）翻转为硬断言。收益与方向 1 叠加，改动小、只动一个文件。

### 方向 3：消息区按行预算裁剪（消灭溢出全清）

`MessageList` 按消息**条数**截断（MAX_MESSAGES = max(viewHeight, 15)），单条多行消息直接顶爆视口
触发 ink 全清（S3 实测 1 次 `\x1b[2J`，PTY 层实测 2 次）。
**落地**：按**渲染行数**做预算裁剪（从尾部向前累计行数至 viewHeight），
把 S3 的 fullClearCount 基线从 1 压到 0。这是全清类闪烁的最大单点来源。

### 方向 4：修复探索中发现的正确性 bug（低成本高确定性）

- **`/help`、`/sessions` 崩溃**：`App.js:111,122,132` 调用 `setMessages`，但 `useSessionEvents`
  的返回对象未导出它 → ReferenceError。补导出即可，并配回归测试。
- **`warmupHighlight` 死代码**：format-token.js 导出但从未调用，且其 `getHighlight` 与
  Markdown.js 的 `loadHighlight` 是**两套平行加载器**，前者加载完不会触发重渲染（白加载）。
  统一到一套（保留 Markdown.js 的，删或改接 format-token 的）。
- **`StreamingMarkdown` render 期突变 ref**（Markdown.js:113-128）：并发模式下是隐患，
  迁移到 useEffect/useMemo 语义。

### 方向 5：交互差距补全（对标 roadmap 阶段五/六）

从"能用"到"跟手"，按用户可感知度排序：

1. **消息滚动**：当前仅 PageUp/Down 按条切片，无滚轮、无 sticky 钉底、无虚拟列表。
   先加滚轮（ink 支持 mouse 事件解析）+ 滚动位置指示，虚拟列表视长对话实测再定。
2. **Ctrl+C 语义**：time-double-press（800ms）先中断 turn 后退出（roadmap 1.3/5.3）。
3. **状态栏增强**：token 用量/成本/turn 号（数据已在 useSessionEvents 的 usage 里，纯展示）。
4. **会话恢复 UI**：`session/list` + `session/resume` 已有 client 方法（main.js resume 流程在用），
   缺 TUI 内选择界面（/resume 斜杠命令 + 列表选择器）。

---

## 建议的落地顺序

| 批次 | 内容 | 理由 |
|---|---|---|
| 第一批 | 方向 1.1（incrementalRendering spike）+ 方向 4（bug 修复） | 投入最小、立即改善体验、测试网兜底 |
| 第二批 | 方向 1.2（Static）+ 方向 3（行预算裁剪） | 消灭两类最大的闪烁源 |
| 第三批 | 方向 2（合帧）+ 方向 1.3（时钟收口） | 翻转 S1-target/S2-target 靶点 |
| 第四批 | 方向 5（交互补全） | 对标剩余交互维度 |

每批完成的标准动作：`UPDATE_BASELINES=1` 重校准基线、翻转达标的 test.fails 靶点、提交。
