import React from 'react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderInk, flushFrames } from '../flicker/helpers/test-stdout.js';
import { visibleLines } from '../flicker/helpers/frame-metrics.js';
import { makeMockClient, makeScript } from '../flicker/helpers/event-source.js';
import { App } from '../../src/tui/App.js';

/**
 * 空闲布局回归：turn 完成后答案进入 Static，动态区不应再用
 * 空白填满整个视口（否则把 Static 里的答案挤出视口——现场"一闪而过"）。
 */

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('turn 完成后动态区收缩到内容高度，答案留在视口内', async () => {
  const client = makeMockClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }), { columns: 100, rows: 30 });
  await flushFrames(100);

  await makeScript(client).turnStart(1).run();
  await flushFrames(50);
  await makeScript(client).textDelta('这是答案ANSWER', { mid: 'm1' }).run();
  await flushFrames(50);
  await makeScript(client).turnComplete(1).run();
  await flushFrames(200);

  // turn 结束自动重绘会完整重写动态区，末帧即动态区全貌
  const last = app.stdout.frames.at(-1);
  const totalLines = visibleLines(last).length;
  // 空闲动态区应收缩到内容高度（状态栏+输入+提示 ≈3-6 行），
  // 而不是用空白填满 30 行视口把 Static 里的答案挤出去（现场“一闪而过”）
  expect(totalLines).toBeLessThanOrEqual(10);
  // 答案已打印进 Static（在更早的帧中），动态区不重印
  expect(app.stdout.frames.join('')).toContain('这是答案ANSWER');
  app.unmount();
});

test('流式期间动态区仍不超过视口（防溢出全清）', async () => {
  const client = makeMockClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }), { columns: 100, rows: 20 });
  await flushFrames(100);
  app.stdout.frames.length = 0;

  const longText = Array.from({ length: 60 }, (_, i) => `长行-${i}`).join('\n');
  await makeScript(client).turnStart(1).textDelta(longText, { mid: 'm1' }).run();
  await flushFrames(200);

  // 动态区输出高度不得超过视口（overflow hidden 裁剪，无全清）
  const last = app.stdout.frames.at(-1);
  expect(visibleLines(last).length).toBeLessThanOrEqual(20);
  expect(app.stdout.frames.join('')).not.toContain('\x1b[2J');
  app.unmount();
});
