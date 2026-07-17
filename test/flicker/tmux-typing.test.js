import React from 'react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderInk, flushFrames } from './helpers/test-stdout.js';
import { measureFrames, perFrameDiffLines } from './helpers/frame-metrics.js';
import { makeMockClient } from './helpers/event-source.js';
import { checkBaseline } from './helpers/baseline.js';
import { App } from '../../src/tui/App.js';

/**
 * S8: tmux 输入闪烁场景（对应用户在 tmux 中击键可见的闪烁）。
 *
 * 机理：tmux 不支持 DEC 2026 同步输出，ink 写入的 BSU/ESU 标记在 tmux 下
 * 不构成原子帧（tmux 不缓冲、透传不可靠），于是每次击键触发的
 * 「整屏 eraseLines + 重写」都直接暴露为可见闪烁。
 * 本场景度量该重写的规模（eraseLinesTotal）与冗余度（perFrameDiffLines），
 * 并对照 ink 7 的 incrementalRendering（行级 diff）验证修复方向。
 */

// 构造接近满屏的历史：多行 assistant 回复 + 若干轮对话
const HISTORY = [
  { role: 'user', text: '帮我看一下这个函数' },
  {
    role: 'assistant',
    text: Array.from({ length: 12 }, (_, i) => `第${i + 1}行分析：这段代码的主要逻辑……`).join('\n'),
  },
  { role: 'user', text: '那性能呢' },
  {
    role: 'assistant',
    text: Array.from({ length: 8 }, (_, i) => `性能建议${i + 1}：可以考虑缓存结果`).join('\n'),
  },
];

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

async function runTyping({ incrementalRendering = false } = {}) {
  const client = makeMockClient();
  const app = renderInk(
    React.createElement(App, { client, sessionId: 'sess_test', initialMessages: HISTORY }),
    { columns: 100, rows: 30, incrementalRendering },
  );
  await flushFrames(50);
  app.stdout.frames.length = 0; // 只度量击键阶段

  for (let i = 0; i < 10; i++) {
    app.stdin.write('x');
    await flushFrames(50);
  }

  const metrics = measureFrames(app.stdout.frames, { durationMs: 500 });
  metrics.diffLinesPerFrame = perFrameDiffLines(app.stdout.frames);
  // 跳过窗口首帧（首帧 diff = 全屏行数，属测量起点而非内容变化）
  metrics.maxDiffLines = Math.max(0, ...metrics.diffLinesPerFrame.slice(1));
  app.unmount();
  return metrics;
}

test('S8: 满屏历史下击键 —— 每次击键整屏重写，但实际只改 1 行（冗余证明）', async () => {
  const m = await runTyping();
  expect(m.frameCount).toBeLessThanOrEqual(11); // 10 击键 + 余量
  expect(m.fullClearCount).toBe(0);
  // 关键证据：每帧实际变化 ≤2 行（输入行），但整屏都在被擦除重写
  expect(m.maxDiffLines).toBeLessThanOrEqual(2);
  checkBaseline('s8-typing-default', m);
});

test('S8c: 溢出历史（长会话现场）击键 —— 零全清、零整屏擦除', async () => {
  // 复现 tmux 现场：历史远超视口（40 行 > rows=20）时，
  // ink 溢出回退每帧 ESC[2J 全清+全量重写（现场实测每击键 2 帧 × 7KB）。
  // 修复：App 根高度锁定 rows + 消息区行预算裁剪 → 输出永不超视口。
  const client = makeMockClient();
  const longHistory = [
    { role: 'user', text: '初始问题' },
    { role: 'assistant', text: Array.from({ length: 40 }, (_, i) => `历史行-${i}`).join('\n') },
  ];
  const app = renderInk(
    React.createElement(App, { client, sessionId: 'sess_test', initialMessages: longHistory }),
    { columns: 100, rows: 20 },
  );
  await flushFrames(50);
  // 内容正确性：最新消息尾部在视口内可见（flex-end 锁定最新内容）
  expect(app.stdout.frames.join('')).toContain('历史行-39');
  app.stdout.frames.length = 0;

  for (let i = 0; i < 5; i++) {
    app.stdin.write('x');
    await flushFrames(50);
  }

  const m = measureFrames(app.stdout.frames, { durationMs: 250 });
  expect(m.fullClearCount).toBe(0);        // 修复前：每帧 1 次全清
  expect(m.eraseLinesTotal).toBe(0);       // 修复前：整屏 eraseLines
  expect(app.frames.join('')).toContain('xxxxx'); // 输入内容正常
  checkBaseline('s8c-overflow-typing', m);
  app.unmount();
});

test('S8b: incrementalRendering 对照 —— 擦除量应大幅下降（修复方向验证）', async () => {
  const def = await runTyping({ incrementalRendering: false });
  const inc = await runTyping({ incrementalRendering: true });

  // 内容正确性：增量模式输出相同可见内容
  expect(inc.fullClearCount).toBe(0);
  // 核心断言：增量渲染的擦除行数不到默认模式的一半
  expect(
    inc.eraseLinesTotal,
    `incremental eraseLines=${inc.eraseLinesTotal} vs default=${def.eraseLinesTotal}`,
  ).toBeLessThan(def.eraseLinesTotal * 0.5);
  checkBaseline('s8-typing-incremental', inc);
});
