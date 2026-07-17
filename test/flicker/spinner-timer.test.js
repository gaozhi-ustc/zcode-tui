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
