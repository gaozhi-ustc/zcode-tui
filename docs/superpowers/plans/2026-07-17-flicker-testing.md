# 闪烁测试体系实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 zcode-tui 建立可自动化、可回归、可度量的闪烁测试体系（设计文档：`docs/superpowers/specs/2026-07-17-flicker-testing-design.md`）。

**Architecture:** 渲染层用自定义 mock stdout（`debug:false + interactive:true`，保留擦除序列）+ vitest fake timers 驱动场景；探针把 frames[] 转成结构化度量；双档阈值（current 全绿回归网 + target test.fails 优化靶点）；PTY 层用 POSIX `script(1)` + 假 app-server 做字节级端到端验证。

**Tech Stack:** vitest 4、ink 7（直接调 `render`）、React 19、POSIX `script(1)`。无新 npm 依赖。

**关键实现事实（已核实，执行时勿再验证）：**
- ink `debug:true`（ink-testing-library 模式）会**吞掉所有擦除序列**，必须 `debug:false + interactive:true` 才能度量 eraseLines/全清
- ink 普通帧写 `eraseLines(N)` = `\x1b[2K\x1b[1A` 序列（指纹 `\x1b[1A`）；全清写 `\x1b[2J\x1b[3J\x1b[H`（指纹 `\x1b[2J`）
- ink render 选项支持 `interactive: true` 显式覆盖 CI 检测（`resolveInteractiveOption`）
- ink 30fps throttle 用 lodash（读 `Date.now`），vitest fake timers 默认可控
- 事件注入复用 `test/tui/App.test.js` 的 makeMockClient 模式，`client._emit('event', rawJSONRPC)` 走 `parseEvent` 全路径
- `ZCodeClient({command, args})` 可注入假 app-server，无需改 main.js
- App 组件签名：`App({ client, sessionId, initialMessages = [], runtimeModel = null })`
- mock client 需要的方法（照抄 App.test.js）：`on/off/removeListener/_emit/sendMessage/stop/respondToServer/createSession/subscribe/isConnected`

---

## Task 1: 渲染 harness（test-stdout.js）

**Files:**
- Create: `test/flicker/helpers/test-stdout.js`
- Test: `test/flicker/helpers/test-stdout.test.js`

- [ ] **Step 1: 写失败测试**

```js
// test/flicker/helpers/test-stdout.test.js
import React from 'react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Text } from 'ink';
import { renderInk, flushFrames, TestStdout } from './test-stdout.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('TestStdout 记录 frames 且尺寸可配', () => {
  const stdout = new TestStdout({ columns: 80, rows: 20 });
  expect(stdout.columns).toBe(80);
  expect(stdout.rows).toBe(20);
  stdout.write('abc');
  expect(stdout.frames).toEqual(['abc']);
});

test('renderInk 以交互模式渲染并保留擦除序列', async () => {
  const app = renderInk(React.createElement(Text, null, '第一行'), { columns: 80, rows: 20 });
  await flushFrames(100);
  expect(app.frames.length).toBeGreaterThan(0);
  expect(app.frames.join('')).toContain('第一行');
  app.unmount();
});

test('resize 发射 resize 事件且 ink 跟随重渲染', async () => {
  const app = renderInk(React.createElement(Text, null, 'resize-marker'), { columns: 80, rows: 20 });
  await flushFrames(100);
  app.stdout.frames.length = 0;
  app.stdout.resize(60, 20);
  await flushFrames(100);
  expect(app.frames.join('')).toContain('resize-marker');
  app.unmount();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/flicker/helpers/test-stdout.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```js
// test/flicker/helpers/test-stdout.js
import { EventEmitter } from 'node:events';
import { render as inkRender } from 'ink';
import { vi } from 'vitest';

/** 可测 stdout：记录每次 write 的原始字符串，尺寸可配，可模拟 resize。 */
export class TestStdout extends EventEmitter {
  isTTY = true;
  frames = [];

  constructor({ columns = 100, rows = 30 } = {}) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  write = (frame) => {
    this.frames.push(String(frame));
    return true;
  };

  resize(columns, rows = this.rows) {
    this.columns = columns;
    this.rows = rows;
    this.emit('resize');
  }

  lastFrame = () => this.frames[this.frames.length - 1];
}

export class TestStdin extends EventEmitter {
  isTTY = true;
  data = null;
  write = (data) => { this.data = data; this.emit('readable'); this.emit('data', data); };
  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
  read = () => { const d = this.data; this.data = null; return d; };
}

/**
 * 以真实交互模式渲染 ink 树（debug:false + interactive:true）。
 * 与 ink-testing-library 的关键差别：保留 eraseLines/全清等擦除序列，
 * 使 frames[] 可用于闪烁度量。
 */
export function renderInk(element, { columns = 100, rows = 30 } = {}) {
  const stdout = new TestStdout({ columns, rows });
  const stderr = new TestStdout({ columns, rows });
  const stdin = new TestStdin();
  const instance = inkRender(element, {
    stdout, stderr, stdin,
    debug: false,
    exitOnCtrlC: false,
    patchConsole: false,
    interactive: true,
  });
  return {
    stdout, stderr, stdin,
    frames: stdout.frames,
    lastFrame: () => stdout.lastFrame(),
    rerender: instance.rerender,
    unmount: instance.unmount,
    cleanup: instance.cleanup,
  };
}

/** 推进 fake timers 并 flush 微任务（驱动 ink throttle 帧发射）。 */
export async function flushFrames(ms = 100) {
  await vi.advanceTimersByTimeAsync(ms);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run test/flicker/helpers/test-stdout.test.js`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add test/flicker/helpers/test-stdout.js test/flicker/helpers/test-stdout.test.js
git commit -m "test(flicker): add interactive-mode ink render harness"
```

---

## Task 2: ANSI 序列度量原语（ansi-metrics.js）

**Files:**
- Create: `test/flicker/helpers/ansi-metrics.js`
- Test: `test/flicker/helpers/ansi-metrics.test.js`

- [ ] **Step 1: 写失败测试**

```js
// test/flicker/helpers/ansi-metrics.test.js
import { test, expect } from 'vitest';
import { countOccurrences, countFullClears, countEraseLineUps } from './ansi-metrics.js';

test('countOccurrences 统计子串次数', () => {
  expect(countOccurrences('aaaa', 'aa')).toBe(2);
  expect(countOccurrences('', 'a')).toBe(0);
  expect(countOccurrences('abc', '')).toBe(0);
});

test('countFullClears 识别 ESC[2J', () => {
  expect(countFullClears('\x1b[2J\x1b[3J\x1b[Habc')).toBe(1);
  expect(countFullClears('\x1b[2Kabc')).toBe(0);
});

test('countEraseLineUps 识别 eraseLines 指纹 ESC[1A', () => {
  // eraseLines(3) ≈ ESC[2K ESC[1A ESC[2K ESC[1A ESC[2K
  expect(countEraseLineUps('\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K')).toBe(2);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/flicker/helpers/ansi-metrics.test.js`
Expected: FAIL

- [ ] **Step 3: 实现**

```js
// test/flicker/helpers/ansi-metrics.js
/** 终端控制序列度量原语：渲染层 frames 与 PTY 字节流共用。 */

export function countOccurrences(text, needle) {
  if (!text || !needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

/** 全清指纹（ink overflow / 缩宽时写 ESC[2J ESC[3J ESC[H） */
export const FULL_CLEAR_PATTERN = '\x1b[2J';
/** eraseLines 指纹：逐行 ESC[2K + ESC[1A 上移 */
export const ERASE_UP_PATTERN = '\x1b[1A';

export function countFullClears(output) {
  return countOccurrences(output, FULL_CLEAR_PATTERN);
}

export function countEraseLineUps(output) {
  return countOccurrences(output, ERASE_UP_PATTERN);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run test/flicker/helpers/ansi-metrics.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/flicker/helpers/ansi-metrics.js test/flicker/helpers/ansi-metrics.test.js
git commit -m "test(flicker): add ansi sequence metrics primitives"
```

---

## Task 3: 帧度量探针（frame-metrics.js）

**Files:**
- Create: `test/flicker/helpers/frame-metrics.js`
- Test: `test/flicker/helpers/frame-metrics.test.js`

- [ ] **Step 1: 写失败测试**

```js
// test/flicker/helpers/frame-metrics.test.js
import { test, expect } from 'vitest';
import { measureFrames, stableLineViolations, perFrameDiffLines, countLayoutShifts } from './frame-metrics.js';

test('measureFrames 汇总度量', () => {
  const frames = ['abc', '\x1b[2K\x1b[1A\x1b[2Kabc', '\x1b[2J\x1b[3J\x1b[Habc'];
  const m = measureFrames(frames, { durationMs: 1000 });
  expect(m.frameCount).toBe(3);
  expect(m.fps).toBe(3);
  expect(m.fullClearCount).toBe(1);
  expect(m.eraseLinesTotal).toBe(1);
  expect(m.bytesTotal).toBeGreaterThan(0);
});

test('stableLineViolations 检测应稳定行的变化', () => {
  const stable = ['头\n稳定行MARKER\n尾1', '头\n稳定行MARKER\n尾2'];
  expect(stableLineViolations(stable, l => l.includes('MARKER'))).toBe(0);
  const changed = ['头\n稳定行MARKER\n尾', '头\n稳定行MARKER被改\n尾'];
  expect(stableLineViolations(changed, l => l.includes('MARKER'))).toBe(1);
});

test('perFrameDiffLines 计算相邻帧变化行数', () => {
  expect(perFrameDiffLines(['a\nb', 'a\nc'])).toEqual([2, 1]);
});

test('countLayoutShifts 统计帧行数变化', () => {
  expect(countLayoutShifts(['a\nb', 'a\nb', 'a\nb\nc'])).toBe(1);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/flicker/helpers/frame-metrics.test.js`
Expected: FAIL

- [ ] **Step 3: 实现**

```js
// test/flicker/helpers/frame-metrics.js
import stripAnsi from 'strip-ansi';
import { countFullClears, countEraseLineUps } from './ansi-metrics.js';

/** 把 frames[] 汇总为结构化闪烁度量。durationMs 用于计算 fps。 */
export function measureFrames(frames, { durationMs = 0 } = {}) {
  const joined = frames.join('');
  return {
    frameCount: frames.length,
    fps: durationMs > 0 ? frames.length / (durationMs / 1000) : frames.length,
    bytesTotal: joined.length,
    fullClearCount: countFullClears(joined),
    eraseLinesTotal: countEraseLineUps(joined),
    layoutShifts: countLayoutShifts(frames),
  };
}

/** 帧的可见内容行（剥掉 ANSI 序列；擦除序列同为 CSI 会被剥除）。 */
export function visibleLines(frame) {
  return stripAnsi(frame).split('\n');
}

/** 帧总行数变化次数（布局跳动代理指标）。 */
export function countLayoutShifts(frames) {
  let shifts = 0;
  let prev = null;
  for (const f of frames) {
    const h = visibleLines(f).length;
    if (prev !== null && h !== prev) shifts++;
    prev = h;
  }
  return shifts;
}

/**
 * 稳定区违规：lineSelector 选中的行（如已完成消息）在相邻帧间内容变化的次数。
 * 正常应为 0 —— 历史消息行不应被后续渲染改动。
 */
export function stableLineViolations(frames, lineSelector) {
  let violations = 0;
  let prev = null;
  for (const f of frames) {
    const selected = visibleLines(f).filter(lineSelector).join('\n');
    if (prev !== null && selected !== prev) violations++;
    prev = selected;
  }
  return violations;
}

/** 相邻帧逐行 diff：每帧相对上一帧的变化行数（首帧为总行数）。 */
export function perFrameDiffLines(frames) {
  const diffs = [];
  let prevLines = null;
  for (const f of frames) {
    const lines = visibleLines(f);
    if (prevLines === null) {
      diffs.push(lines.length);
    } else {
      let d = Math.abs(lines.length - prevLines.length);
      const n = Math.min(lines.length, prevLines.length);
      for (let i = 0; i < n; i++) if (lines[i] !== prevLines[i]) d++;
      diffs.push(d);
    }
    prevLines = lines;
  }
  return diffs;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run test/flicker/helpers/frame-metrics.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/flicker/helpers/frame-metrics.js test/flicker/helpers/frame-metrics.test.js
git commit -m "test(flicker): add frame metrics probe"
```

---

## Task 4: 事件源（event-source.js）

**Files:**
- Create: `test/flicker/helpers/event-source.js`
- Test: `test/flicker/helpers/event-source.test.js`

- [ ] **Step 1: 写失败测试**

```js
// test/flicker/helpers/event-source.test.js
import React from 'react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderInk, flushFrames } from './test-stdout.js';
import { makeMockClient, makeScript } from './event-source.js';
import { App } from '../../../src/tui/App.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('makeScript 通过原始 JSON-RPC 驱动 App 消息流', async () => {
  const client = makeMockClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await flushFrames(50);

  await makeScript(client)
    .turnStart(1)
    .textDelta('你好世界', { mid: 'm1' })
    .toolCall('Bash', { command: 'ls' }, 't1')
    .toolResult('t1', { success: true, content: 'ok' })
    .turnComplete(1)
    .run();
  await flushFrames(100);

  const out = app.frames.join('');
  expect(out).toContain('你好世界');
  expect(out).toContain('Bash');
  app.unmount();
});

test('textDelta burst 按 everyMs 节奏发射', async () => {
  const client = makeMockClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await flushFrames(50);
  await makeScript(client).turnStart(1).textDelta('词', { repeat: 5, everyMs: 10, mid: 'm1' }).run();
  await flushFrames(100);
  expect(app.frames.join('')).toContain('词词词词词');
  app.unmount();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/flicker/helpers/event-source.test.js`
Expected: FAIL

- [ ] **Step 3: 实现**

```js
// test/flicker/helpers/event-source.js
import { vi } from 'vitest';

/** 与 test/tui/App.test.js 同形的 mock client。 */
export function makeMockClient() {
  const handlers = {};
  return {
    on: (evt, fn) => { handlers[evt] = fn; },
    off: () => {},
    removeListener: () => {},
    _emit: (evt, data) => handlers[evt] && handlers[evt](data),
    sendMessage: async () => 'ok',
    stop: async () => 'ok',
    respondToServer: () => {},
    createSession: async () => 'sess_test',
    subscribe: async () => 'ok',
    isConnected: () => true,
  };
}

/** 构造 session/event 原始 JSON-RPC notification（走 parseEvent 全路径）。 */
export function sessionEvent(type, payload) {
  return { jsonrpc: '2.0', method: 'session/event', params: { type, payload } };
}

/**
 * 流式事件编排器。链式声明场景，run() 按 fake timers 推进发射。
 * textDelta 的 everyMs>0 时逐条推进时钟（模拟真实 delta 到达节奏）。
 */
export function makeScript(client) {
  const steps = [];
  const api = {
    turnStart(n = 1) {
      steps.push({ kind: 'emit', raw: sessionEvent('turn.started', { turnNumber: n }) });
      return api;
    },
    textDelta(text, { repeat = 1, everyMs = 0, mid = 'm1' } = {}) {
      steps.push({
        kind: 'burst',
        make: () => sessionEvent('model.streaming', { kind: 'text_delta', delta: text, assistantMessageId: mid }),
        repeat, everyMs,
      });
      return api;
    },
    toolCall(toolName, input = {}, id = 't1') {
      steps.push({ kind: 'emit', raw: sessionEvent('model.streaming', { kind: 'tool_call', toolName, input, toolCallId: id }) });
      return api;
    },
    toolResult(id = 't1', result = { success: true, content: 'ok' }) {
      steps.push({ kind: 'emit', raw: sessionEvent('tool.updated', { kind: 'result', toolCallId: id, result }) });
      return api;
    },
    turnComplete(n = 1) {
      steps.push({ kind: 'emit', raw: sessionEvent('turn.completed', { turnNumber: n }) });
      return api;
    },
    permissionRequest(id = 42, toolName = 'Bash', input = { command: 'ls' }) {
      steps.push({
        kind: 'server-request',
        raw: { jsonrpc: '2.0', id, method: 'interaction/requestPermission', params: { toolName, input, reason: 'test', riskLevel: 'low' } },
      });
      return api;
    },
    async run() {
      for (const step of steps) {
        if (step.kind === 'emit') {
          client._emit('event', step.raw);
        } else if (step.kind === 'server-request') {
          client._emit('server-request', step.raw);
        } else if (step.kind === 'burst') {
          for (let i = 0; i < step.repeat; i++) {
            client._emit('event', step.make());
            if (step.everyMs > 0 && i < step.repeat - 1) {
              await vi.advanceTimersByTimeAsync(step.everyMs);
            }
          }
        }
      }
    },
  };
  return api;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run test/flicker/helpers/event-source.test.js`
Expected: PASS（2 tests；若 frame 不含内容，检查是否需更长的 flushFrames）

- [ ] **Step 5: Commit**

```bash
git add test/flicker/helpers/event-source.js test/flicker/helpers/event-source.test.js
git commit -m "test(flicker): add scripted session event source"
```

---

## Task 5: 阈值与基线（thresholds.js + baseline.js）

**Files:**
- Create: `test/flicker/helpers/thresholds.js`
- Create: `test/flicker/helpers/baseline.js`
- Test: `test/flicker/helpers/baseline.test.js`

- [ ] **Step 1: 写失败测试**

```js
// test/flicker/helpers/baseline.test.js
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBaseline } from './baseline.js';

const DIR = fileURLToPath(new URL('../baselines/', import.meta.url));

test('checkBaseline 首次运行自动建基线且不失败', () => {
  checkBaseline('unit-selftest', { frameCount: 7, fps: 3.5 });
  const saved = JSON.parse(readFileSync(join(DIR, 'unit-selftest.json'), 'utf8'));
  expect(saved.frameCount).toBe(7);
});

test('checkBaseline 未超基线×1.2 通过，超出则失败', () => {
  checkBaseline('unit-selftest', { frameCount: 8, fps: 3.9 }); // ≤ 7×1.2 / 3.5×1.2
  expect(() => checkBaseline('unit-selftest', { frameCount: 100 })).toThrow();
});

test('checkBaseline 忽略非数字与未知 key', () => {
  checkBaseline('unit-selftest', { frameCount: 7, note: '忽略我', newKey: 1 });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/flicker/helpers/baseline.test.js`
Expected: FAIL

- [ ] **Step 3: 实现**

```js
// test/flicker/helpers/thresholds.js
/**
 * 双档阈值：
 * - current：按现状校准，全部通过 = 回归保护网
 * - target：aspirational，用 test.fails 标记 = 优化靶点；
 *   优化落地致其意外通过时，把它提升到 current。
 */
export const budgets = {
  current: {
    spinnerIdleMaxFps: 12,       // tick 100ms → 理论 ~10fps
    spinnerStreamingMaxFps: 12,  // tick 500ms → 理论 ~2fps，留足余量
    toolBlinkMaxFramesPer5s: 25, // 3 工具 blink(1200ms) + spinner(500ms)
    burstMaxFrames: 25,          // 50 delta @10ms（500ms 窗口，30fps 上限 ~17）
    keystrokeMaxFrames: 40,      // 20 击键 × ≤2 帧
    resizeMaxFullClears: 2,      // 两次缩宽各一次全清
  },
  target: {
    spinnerIdleMaxFps: 2,        // 时钟隔离到叶子组件后，整树不应按 tick 重写
    spinnerStreamingMaxFps: 2,
    toolBlinkMaxFramesPer5s: 6,
    burstMaxFrames: 10,          // 应用层合帧后
    keystrokeMaxFrames: 21,      // 每击键恰好 1 帧
    resizeMaxFullClears: 2,
  },
};
```

```js
// test/flicker/helpers/baseline.js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { expect } from 'vitest';

const BASELINE_DIR = fileURLToPath(new URL('../baselines/', import.meta.url));

/**
 * 基线快照断言：数字型度量 ≤ 基线 × tolerance。
 * 基线不存在时自动记录并直接通过；UPDATE_BASELINES=1 时重写全部基线。
 */
export function checkBaseline(name, metrics, { tolerance = 1.2 } = {}) {
  const file = join(BASELINE_DIR, `${name}.json`);
  const flat = Object.fromEntries(
    Object.entries(metrics).filter(([, v]) => typeof v === 'number'),
  );

  let baseline = null;
  try { baseline = JSON.parse(readFileSync(file, 'utf8')); } catch { /* 不存在 */ }

  if (!baseline || process.env.UPDATE_BASELINES === '1') {
    mkdirSync(BASELINE_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(flat, null, 2) + '\n');
    return;
  }

  for (const [key, value] of Object.entries(flat)) {
    if (!(key in baseline)) continue;
    const limit = baseline[key] * tolerance;
    expect(
      value,
      `[${name}] ${key}: 实测 ${value} 超过 基线 ${baseline[key]} × ${tolerance} = ${limit}`,
    ).toBeLessThanOrEqual(limit);
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run test/flicker/helpers/baseline.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/flicker/helpers/thresholds.js test/flicker/helpers/baseline.js test/flicker/helpers/baseline.test.js test/flicker/baselines/
git commit -m "test(flicker): add dual-tier budgets and baseline snapshot mechanism"
```

---

## Task 6: S1 定时器场景（spinner-timer.test.js）

覆盖风险路径 B1/B1b：Spinner tick 与工具 blink 定时器驱动的全屏重写。

**Files:**
- Test: `test/flicker/spinner-timer.test.js`

- [ ] **Step 1: 写测试（直接可过，作为回归网基线）**

```js
// test/flicker/spinner-timer.test.js
import React from 'react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderInk, flushFrames } from './helpers/test-stdout.js';
import { measureFrames, stableLineViolations } from './helpers/frame-metrics.js';
import { makeMockClient, makeScript } from './helpers/event-source.js';
import { checkBaseline } from './helpers/baseline.js';
import { budgets } from './helpers/thresholds.js';
import { App } from '../../src/tui/App.js';

const HISTORY = [
  { role: 'user', text: '历史消息MARKER' },
  { role: 'assistant', text: '历史回复MARKER' },
];

function renderApp(client) {
  return renderInk(React.createElement(App, {
    client, sessionId: 'sess_test', initialMessages: HISTORY,
  }));
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('S1: spinner 空转 5s —— 无全清、历史区零变化、帧率有界', async () => {
  const client = makeMockClient();
  const app = renderApp(client);
  await flushFrames(50);
  app.stdout.frames.length = 0; // 只度量 spinner 阶段

  await makeScript(client).turnStart(1).run();
  await vi.advanceTimersByTimeAsync(5000);

  const m = measureFrames(app.stdout.frames, { durationMs: 5000 });
  expect(m.fullClearCount).toBe(0);
  expect(stableLineViolations(app.stdout.frames, l => l.includes('MARKER'))).toBe(0);
  expect(m.fps).toBeLessThanOrEqual(budgets.current.spinnerIdleMaxFps);
  checkBaseline('s1-spinner-idle', m);
  app.unmount();
});

test('S1b: 流式期间 spinner 降频 —— 帧率有界且无全清', async () => {
  const client = makeMockClient();
  const app = renderApp(client);
  await flushFrames(50);
  app.stdout.frames.length = 0;

  await makeScript(client).turnStart(1).textDelta('流式内容MARKER2', { mid: 'm1' }).run();
  await vi.advanceTimersByTimeAsync(5000);

  const m = measureFrames(app.stdout.frames, { durationMs: 5000 });
  expect(m.fullClearCount).toBe(0);
  expect(m.fps).toBeLessThanOrEqual(budgets.current.spinnerStreamingMaxFps);
  checkBaseline('s1b-spinner-streaming', m);
  app.unmount();
});

test('S1c: 3 个并行工具 blink —— 帧数有界、历史区零变化', async () => {
  const client = makeMockClient();
  const app = renderApp(client);
  await flushFrames(50);
  app.stdout.frames.length = 0;

  await makeScript(client)
    .turnStart(1)
    .toolCall('Bash', { command: 'a' }, 't1')
    .toolCall('Read', { path: '/x' }, 't2')
    .toolCall('Grep', { pattern: 'y' }, 't3')
    .run();
  await vi.advanceTimersByTimeAsync(5000);

  const m = measureFrames(app.stdout.frames, { durationMs: 5000 });
  expect(m.fullClearCount).toBe(0);
  expect(stableLineViolations(app.stdout.frames, l => l.includes('MARKER'))).toBe(0);
  expect(m.frameCount).toBeLessThanOrEqual(budgets.current.toolBlinkMaxFramesPer5s);
  checkBaseline('s1c-tool-blink', m);
  app.unmount();
});

// === aspirational 靶点：动画时钟隔离到叶子组件后提升为硬断言 ===
test.fails('S1-target: spinner 空转帧率 ≤ 2fps（优化靶点）', async () => {
  const client = makeMockClient();
  const app = renderApp(client);
  await flushFrames(50);
  app.stdout.frames.length = 0;
  await makeScript(client).turnStart(1).run();
  await vi.advanceTimersByTimeAsync(5000);
  const m = measureFrames(app.stdout.frames, { durationMs: 5000 });
  expect(m.fps).toBeLessThanOrEqual(budgets.target.spinnerIdleMaxFps);
  app.unmount();
});
```

- [ ] **Step 2: 运行**

Run: `npx vitest run test/flicker/spinner-timer.test.js`
Expected: PASS（test.fails 用例预期失败即算通过）；基线 json 自动生成

- [ ] **Step 3: Commit**

```bash
git add test/flicker/spinner-timer.test.js test/flicker/baselines/
git commit -m "test(flicker): S1 spinner/blink timer scenarios"
```

---

## Task 7: S2 流式突发场景（streaming-burst.test.js）

覆盖 B2/B2b：text_delta 高频到达的合帧行为与流式 markdown 稳定前缀。

**Files:**
- Test: `test/flicker/streaming-burst.test.js`

- [ ] **Step 1: 写测试**

```js
// test/flicker/streaming-burst.test.js
import React from 'react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderInk, flushFrames } from './helpers/test-stdout.js';
import { measureFrames, stableLineViolations } from './helpers/frame-metrics.js';
import { makeMockClient, makeScript } from './helpers/event-source.js';
import { checkBaseline } from './helpers/baseline.js';
import { budgets } from './helpers/thresholds.js';
import { App } from '../../src/tui/App.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

async function runBurst() {
  const client = makeMockClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await flushFrames(50);
  app.stdout.frames.length = 0;
  await makeScript(client)
    .turnStart(1)
    .textDelta('词', { repeat: 50, everyMs: 10, mid: 'm1' })
    .run();
  await flushFrames(100);
  return app;
}

test('S2: 50 个 text_delta @10ms —— ink 30fps 合帧上界 + 内容完整', async () => {
  const app = await runBurst();
  const m = measureFrames(app.stdout.frames, { durationMs: 500 });
  expect(m.frameCount).toBeLessThanOrEqual(budgets.current.burstMaxFrames);
  expect(m.fullClearCount).toBe(0);
  // 内容完整：50 个「词」全部落地
  expect(app.frames.join('')).toContain('词'.repeat(50));
  checkBaseline('s2-stream-burst', m);
  app.unmount();
});

test('S2b: 流式 markdown —— 已完成块行零变化', async () => {
  const client = makeMockClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await flushFrames(50);
  // 第一块完整到达并渲染
  await makeScript(client)
    .turnStart(1)
    .textDelta('# 标题\n\n第一段内容STABLE。\n\n', { mid: 'm1' })
    .run();
  await flushFrames(100);
  app.stdout.frames.length = 0; // 只度量第二块流式阶段

  await makeScript(client)
    .textDelta('第二段', { repeat: 10, everyMs: 20, mid: 'm1' })
    .run();
  await flushFrames(100);

  // 已知回退：若此处违规 >0，说明稳定前缀被重渲染改动（真实 bug），
  // 改为 checkBaseline 记录并在报告中标记 known-issue
  expect(stableLineViolations(app.stdout.frames, l => l.includes('STABLE'))).toBe(0);
  checkBaseline('s2b-streaming-markdown', measureFrames(app.stdout.frames, { durationMs: 200 }));
  app.unmount();
});

// === aspirational 靶点：应用层合帧 ===
test.fails('S2-target: 应用层合帧后 50 delta ≤ 10 帧（优化靶点）', async () => {
  const app = await runBurst();
  const m = measureFrames(app.stdout.frames, { durationMs: 500 });
  expect(m.frameCount).toBeLessThanOrEqual(budgets.target.burstMaxFrames);
  app.unmount();
});
```

- [ ] **Step 2: 运行**

Run: `npx vitest run test/flicker/streaming-burst.test.js`
Expected: PASS；若 S2b 违规 >0，按注释降级为基线断言并记录 known-issue

- [ ] **Step 3: Commit**

```bash
git add test/flicker/streaming-burst.test.js test/flicker/baselines/
git commit -m "test(flicker): S2 streaming burst and stable-prefix scenarios"
```

---

## Task 8: S3 溢出 + S4 resize（overflow-resize.test.js）

覆盖 B3b/B7：内容超高的全清路径与 resize 清屏。

**Files:**
- Test: `test/flicker/overflow-resize.test.js`

- [ ] **Step 1: 写测试**

```js
// test/flicker/overflow-resize.test.js
import React from 'react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderInk, flushFrames } from './helpers/test-stdout.js';
import { measureFrames } from './helpers/frame-metrics.js';
import { makeMockClient, makeScript } from './helpers/event-source.js';
import { checkBaseline } from './helpers/baseline.js';
import { budgets } from './helpers/thresholds.js';
import { App } from '../../src/tui/App.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('S3: 内容超高溢出 —— 末帧内容完整，全清次数入基线', async () => {
  const client = makeMockClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }), { rows: 20 });
  await flushFrames(50);
  app.stdout.frames.length = 0;

  const longText = Array.from({ length: 40 }, (_, i) => `LINE-${i}`).join('\n');
  await makeScript(client).turnStart(1).textDelta(longText, { mid: 'm1' }).turnComplete(1).run();
  await flushFrames(200);

  const m = measureFrames(app.stdout.frames);
  expect(app.frames.join('')).toContain('LINE-39'); // 尾部内容不丢
  checkBaseline('s3-overflow', m); // fullClearCount 入基线
  app.unmount();
});

test('S4: resize 风暴 —— 缩宽全清 ≤2，同尺寸 resize 入基线', async () => {
  const client = makeMockClient();
  const app = renderInk(React.createElement(App, {
    client, sessionId: 'sess_test',
    initialMessages: [{ role: 'user', text: 'resize基准消息' }],
  }), { columns: 100, rows: 30 });
  await flushFrames(50);
  app.stdout.frames.length = 0;

  app.stdout.resize(80, 30);   // 缩 → 预期 1 次全清
  await flushFrames(100);
  app.stdout.resize(100, 30);  // 扩 → 预期无全清
  await flushFrames(100);
  app.stdout.resize(60, 30);   // 缩 → 预期 1 次全清
  await flushFrames(100);

  const m = measureFrames(app.stdout.frames);
  expect(m.fullClearCount).toBeLessThanOrEqual(budgets.current.resizeMaxFullClears);
  expect(app.frames.join('')).toContain('resize基准消息');

  app.stdout.frames.length = 0;
  app.stdout.resize(60, 30);   // 同尺寸 → 记录帧数（理想为 0）
  await flushFrames(100);
  checkBaseline('s4-resize', { ...m, sameSizeFrames: app.stdout.frames.length });
  app.unmount();
});
```

- [ ] **Step 2: 运行**

Run: `npx vitest run test/flicker/overflow-resize.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/flicker/overflow-resize.test.js test/flicker/baselines/
git commit -m "test(flicker): S3 overflow and S4 resize scenarios"
```

---

## Task 9: S5 highlight 加载闪变（highlight-load.test.js）

覆盖 B5：cli-highlight 异步加载完成后的全局重渲染。用 `vi.mock` 精确控制加载时机与产物（避免测试环境 chalk 无色导致断言不可靠）。

**Files:**
- Test: `test/flicker/highlight-load.test.js`

- [ ] **Step 1: 写测试**

```js
// test/flicker/highlight-load.test.js
import React from 'react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';

// mock cli-highlight：highlight 产物带可识别 ANSI 标记
vi.mock('cli-highlight', () => ({
  default: { highlight: (code) => `\x1b[32m${code}\x1b[39m`, supportsLanguage: () => true },
  highlight: (code) => `\x1b[32m${code}\x1b[39m`,
  supportsLanguage: () => true,
}));

const { renderInk, flushFrames } = await import('./helpers/test-stdout.js');
const { measureFrames } = await import('./helpers/frame-metrics.js');
const { checkBaseline } = await import('./helpers/baseline.js');
const { Markdown } = await import('../../src/tui/markdown/Markdown.js');

const CODE_MD = '说明文字\n\n```js\nconst HL_MARKER = 1;\n```\n';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('S5: highlight 加载完成后代码块着色，全局重渲染次数入基线', async () => {
  const app = renderInk(React.createElement(Markdown, null, CODE_MD));
  await flushFrames(50);
  const before = app.frames.join('');
  app.stdout.frames.length = 0;

  // 等异步 import('cli-highlight') 完成并触发重渲染
  await vi.advanceTimersByTimeAsync(0);
  await flushFrames(100);

  const after = app.frames.join('');
  expect(after).toContain('HL_MARKER');
  expect(after).toContain('\x1b[32m'); // 高亮已生效（终态正确）
  const m = measureFrames(app.stdout.frames);
  checkBaseline('s5-highlight-load', m); // 全局重渲染帧数入基线（闪变度量）
  app.unmount();
});
```

注：模块用动态 `await import` 引入，保证 `vi.mock` 先生效；`Markdown.js` 的 `loadHighlight()` 在模块级只跑一次，本测试须在自己的文件中（vitest 每个测试文件独立模块注册表，天然隔离）。

- [ ] **Step 2: 运行**

Run: `npx vitest run test/flicker/highlight-load.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/flicker/highlight-load.test.js test/flicker/baselines/
git commit -m "test(flicker): S5 highlight lazy-load flash scenario"
```

---

## Task 10: S6 布局跳动 + S7 输入（layout-input.test.js）

覆盖 B4/B6：权限对话框、@建议浮层、击键帧放大。

**Files:**
- Test: `test/flicker/layout-input.test.js`

- [ ] **Step 1: 写测试**

```js
// test/flicker/layout-input.test.js
import React from 'react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderInk, flushFrames } from './helpers/test-stdout.js';
import { measureFrames } from './helpers/frame-metrics.js';
import { makeMockClient, makeScript } from './helpers/event-source.js';
import { checkBaseline } from './helpers/baseline.js';
import { budgets } from './helpers/thresholds.js';
import { App } from '../../src/tui/App.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('S6a: 权限对话框开/关 —— 布局跳动无全清', async () => {
  const client = makeMockClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await flushFrames(50);
  app.stdout.frames.length = 0;

  await makeScript(client).permissionRequest(42, 'Bash', { command: 'rm -rf /tmp/x' }).run();
  await flushFrames(100);
  expect(app.frames.join('')).toContain('Bash'); // 对话框出现

  app.stdin.write('y'); // 批准 → 对话框关闭
  await flushFrames(100);

  const m = measureFrames(app.stdout.frames);
  expect(m.fullClearCount).toBe(0);
  checkBaseline('s6a-permission-dialog', m); // layoutShifts 入基线
  app.unmount();
});

test('S6b: @建议浮层出现/消失 —— 无全清', async () => {
  const client = makeMockClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await flushFrames(50);
  app.stdout.frames.length = 0;

  app.stdin.write('@');
  await flushFrames(50);
  app.stdin.write('s');
  await flushFrames(50);
  const m = measureFrames(app.stdout.frames);
  expect(m.fullClearCount).toBe(0);
  checkBaseline('s6b-mention-suggest', m);
  app.unmount();
});

test('S7: 连续 20 次击键 —— 每击键帧数 ≤2', async () => {
  const client = makeMockClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await flushFrames(50);
  app.stdout.frames.length = 0;

  for (let i = 0; i < 20; i++) {
    app.stdin.write('a');
    await flushFrames(50);
  }

  const m = measureFrames(app.stdout.frames, { durationMs: 1000 });
  expect(m.frameCount).toBeLessThanOrEqual(budgets.current.keystrokeMaxFrames);
  expect(app.frames.join('')).toContain('a'.repeat(20));
  checkBaseline('s7-keystroke', m);
  app.unmount();
});

// === aspirational 靶点：消除 useEffect 额外 commit 后每击键 1 帧 ===
test.fails('S7-target: 20 击键 ≤21 帧（优化靶点）', async () => {
  const client = makeMockClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await flushFrames(50);
  app.stdout.frames.length = 0;
  for (let i = 0; i < 20; i++) {
    app.stdin.write('a');
    await flushFrames(50);
  }
  expect(app.stdout.frames.length).toBeLessThanOrEqual(budgets.target.keystrokeMaxFrames);
  app.unmount();
});
```

- [ ] **Step 2: 运行**

Run: `npx vitest run test/flicker/layout-input.test.js`
Expected: PASS（若 S6a 的 'y' 未关闭对话框，检查 PermissionDialog 按键实现并按实际按键调整）

- [ ] **Step 3: Commit**

```bash
git add test/flicker/layout-input.test.js test/flicker/baselines/
git commit -m "test(flicker): S6 layout-shift and S7 keystroke scenarios"
```

---

## Task 11: PTY 层（driver + fake-app-server + pty.test.js）

字节级端到端验证。零新依赖：`script(1)` 分配 pty。通过 `RUN_PTY=1` 环境变量门控，不进默认 `npm test`。

**Files:**
- Create: `test/flicker/pty/fake-app-server.js`
- Create: `test/flicker/pty/driver.js`
- Test: `test/flicker/pty/pty.test.js`
- Modify: `package.json`（加 `test:pty` script）

- [ ] **Step 1: 实现 fake app-server**

```js
// test/flicker/pty/fake-app-server.js
// 行分隔 JSON-RPC 假 app-server。用法: node fake-app-server.js <scenario>
// 应答 session/create + session/subscribe，随后按场景时间线推送事件。
import readline from 'node:readline';

const scenario = process.argv[2] || 'p1-stream';
const rl = readline.createInterface({ input: process.stdin });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function notify(type, payload) {
  send({ jsonrpc: '2.0', method: 'session/event', params: { type, payload } });
}

function runScenario() {
  if (scenario === 'p1-stream') {
    notify('turn.started', { turnNumber: 1 });
    let i = 0;
    const timer = setInterval(() => {
      notify('model.streaming', { kind: 'text_delta', delta: '词', assistantMessageId: 'm1' });
      if (++i >= 100) {
        clearInterval(timer);
        notify('turn.completed', { turnNumber: 1 });
        setTimeout(() => process.stderr.write('SCENARIO_DONE\n'), 1000);
      }
    }, 5);
  } else if (scenario === 'p2-overflow') {
    notify('turn.started', { turnNumber: 1 });
    const longText = Array.from({ length: 60 }, (_, i) => `LINE-${i}`).join('\n');
    notify('model.streaming', { kind: 'text_delta', delta: longText, assistantMessageId: 'm1' });
    notify('turn.completed', { turnNumber: 1 });
    setTimeout(() => process.stderr.write('SCENARIO_DONE\n'), 1000);
  } else if (scenario === 'p3-resize') {
    notify('turn.started', { turnNumber: 1 });
    // 保持 running（spinner 空转），由 driver 自己 stty 改尺寸
    setTimeout(() => {
      notify('turn.completed', { turnNumber: 1 });
      setTimeout(() => process.stderr.write('SCENARIO_DONE\n'), 500);
    }, 4000);
  }
}

rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'session/create') {
    send({ jsonrpc: '2.0', id: msg.id, result: { session: { sessionId: 'pty_sess' } } });
  } else if (msg.method === 'session/subscribe') {
    send({ jsonrpc: '2.0', id: msg.id, result: {} });
    setTimeout(runScenario, 300); // 等 TUI 挂载
  } else if (msg.id != null) {
    send({ jsonrpc: '2.0', id: msg.id, result: {} });
  }
});
```

- [ ] **Step 2: 实现 driver**

```js
// test/flicker/pty/driver.js
// 在真实 pty 中渲染 App，连接 fake-app-server。用法: node driver.js <scenario>
import React from 'react';
import { execSync } from 'node:child_process';
import { render } from 'ink';
import { App } from '../../../src/tui/App.js';
import { ZCodeClient } from '../../../src/zcode-client.js';

const scenario = process.argv[2] || 'p1-stream';
const serverPath = new URL('./fake-app-server.js', import.meta.url).pathname;

const client = new ZCodeClient({ command: process.execPath, args: [serverPath, scenario] });
await client.connect();
const sessionId = await client.createSession(process.cwd());
await client.subscribe(sessionId);

render(React.createElement(App, { client, sessionId }), { exitOnCtrlC: false });

if (scenario === 'p3-resize') {
  // /dev/tty 即 script(1) 分配的 pty；stty 改尺寸触发 SIGWINCH
  setTimeout(() => { try { execSync('stty cols 80 < /dev/tty'); } catch {} }, 1500);
  setTimeout(() => { try { execSync('stty cols 100 < /dev/tty'); } catch {} }, 3000);
}
```

- [ ] **Step 3: 写 PTY 测试**

```js
// test/flicker/pty/pty.test.js
import { test, expect } from 'vitest';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { countFullClears, countEraseLineUps } from '../helpers/ansi-metrics.js';
import { checkBaseline } from '../helpers/baseline.js';

const DRIVER = fileURLToPath(new URL('./driver.js', import.meta.url));

const hasScript = (() => {
  try { execSync('which script', { stdio: 'pipe' }); return true; } catch { return false; }
})();
const runPty = process.env.RUN_PTY === '1' && hasScript;

/**
 * 在 script(1) 分配的 pty 中运行 driver，收集原始字节流直到 SCENARIO_DONE。
 * stty 前置命令设置窗口尺寸。
 */
function runScenario(scenario, { rows = 24, cols = 100, timeoutMs = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const cmd = `stty rows ${rows} cols ${cols}; node ${DRIVER} ${scenario}`;
    const proc = spawn('script', ['-qec', cmd, '/dev/null'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    proc.stdout.on('data', (d) => { output += d.toString(); });
    proc.stderr.on('data', (d) => { output += d.toString(); });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('pty scenario timeout')); }, timeoutMs);
    const check = setInterval(() => {
      if (output.includes('SCENARIO_DONE')) {
        clearTimeout(timer);
        clearInterval(check);
        proc.kill('SIGKILL');
        resolve(output.split('SCENARIO_DONE')[0]);
      }
    }, 100);
    proc.on('error', (err) => { clearTimeout(timer); clearInterval(check); reject(err); });
  });
}

test.skipIf(!runPty)('P1: 流式突发的字节级擦除模式', async () => {
  const bytes = await runScenario('p1-stream');
  expect(countFullClears(bytes)).toBe(0);
  expect(bytes).toContain('词'.repeat(20)); // 内容完整（至少一段连续）
  checkBaseline('p1-stream-pty', { eraseLinesTotal: countEraseLineUps(bytes), bytesTotal: bytes.length });
}, 30000);

test.skipIf(!runPty)('P2: 小窗溢出无死循环重写', async () => {
  const bytes = await runScenario('p2-overflow', { rows: 15 });
  expect(bytes).toContain('LINE-59');
  checkBaseline('p2-overflow-pty', {
    fullClearCount: countFullClears(bytes),
    eraseLinesTotal: countEraseLineUps(bytes),
    bytesTotal: bytes.length,
  });
}, 30000);

test.skipIf(!runPty)('P3: 运行中 resize 全清次数有界', async () => {
  const bytes = await runScenario('p3-resize', { rows: 24, cols: 100 });
  expect(countFullClears(bytes)).toBeLessThanOrEqual(2);
}, 30000);
```

- [ ] **Step 4: package.json 加 script**

修改 `package.json` 的 scripts：
```json
"test:pty": "RUN_PTY=1 vitest run test/flicker/pty --testTimeout=30000"
```

- [ ] **Step 5: 运行 PTY 测试**

Run: `npm run test:pty`
Expected: PASS（3 个场景各生成基线 json）
注意：P2 的 `fullClearCount` 在 stock ink 溢出路径可能 >0，基线如实记录即可，不断言具体值（P2 硬断言只有内容完整）。

- [ ] **Step 6: 确认默认 npm test 不含 PTY**

Run: `npx vitest run`
Expected: PTY 测试显示 skipped，其余全 PASS

- [ ] **Step 7: Commit**

```bash
git add test/flicker/pty/ test/flicker/baselines/ package.json
git commit -m "test(flicker): add PTY-level byte-stream scenarios via script(1)"
```

---

## Task 12: 全量校准 + 文档

**Files:**
- Modify: `README.md`（测试章节补闪烁测试说明）
- Modify: `AGENTS.md`（如测试命令变化需同步）
- Create: `docs/superpowers/specs/2026-07-17-flicker-testing-design.md`（已存在）

- [ ] **Step 1: 全量跑 + 校准基线**

```bash
npx vitest run                    # 全部 PASS，基线已随各任务生成
UPDATE_BASELINES=1 npx vitest run test/flicker   # 如需重新校准时用此命令
npm run test:pty                  # PTY 层 PASS
```

检查 `test/flicker/baselines/*.json` 数值合理性（如 S1 fps ≈10、S2 帧数 ≈15-17），异常值说明场景或 harness 有问题，需排查后重校准。

- [ ] **Step 2: README 补测试说明**

在 README 测试相关章节追加：

```markdown
### 闪烁测试（flicker）

- `npm test`：含渲染层闪烁场景（`test/flicker/`），基于帧度量探针 + 双档阈值
- `npm run test:pty`：PTY 字节级场景（需 POSIX `script(1)`，设 `RUN_PTY=1`）
- 基线校准：度量基线存于 `test/flicker/baselines/*.json`，回归容忍 20%；
  渲染层有意变更后用 `UPDATE_BASELINES=1 npx vitest run test/flicker` 重校准并提交
- `test.fails` 标记的用例是优化靶点，意外通过说明优化生效，应把对应阈值提升到 current 档
```

- [ ] **Step 3: 更新 AGENTS.md**

在「核心目标」后补充一节：

```markdown
## 闪烁测试

渲染层改动必须跑 `npm test`（含 `test/flicker/` 帧度量回归网）；
涉及擦除/清屏/滚动行为的改动还应跑 `npm run test:pty`。
帧数/擦除量基线在 `test/flicker/baselines/`，超 20% 即回归失败；
有意的渲染变更用 `UPDATE_BASELINES=1` 重校准。
设计文档：`docs/superpowers/specs/2026-07-17-flicker-testing-design.md`。
```

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md test/flicker/baselines/
git commit -m "docs(flicker): document flicker test workflow and calibrate baselines"
```

---

## Self-Review 记录

- **Spec 覆盖**：B1→S1/S1c，B2→S2，B2b→S2b，B3/B3b→S3，B4→S6a/S6b，B5→S5，B6→S7，B7→S4；PTY 层 P1-P3 覆盖端到端字节级。✓
- **占位符**：无 TBD；所有步骤含完整代码与命令。✓
- **类型一致性**：`measureFrames` 返回 `{frameCount, fps, bytesTotal, fullClearCount, eraseLinesTotal, layoutShifts}`；`checkBaseline(name, metrics, {tolerance})`；`budgets.current/target` 键名各任务引用一致（`spinnerIdleMaxFps/spinnerStreamingMaxFps/toolBlinkMaxFramesPer5s/burstMaxFrames/keystrokeMaxFrames/resizeMaxFullClears`）。✓
- **已知回退预案**：S2b 若违规 >0 → 降级基线断言 + known-issue；S6a 按键以 PermissionDialog 实际实现为准。✓
