import React from 'react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderInk, flushFrames } from '../flicker/helpers/test-stdout.js';
import { measureFrames } from '../flicker/helpers/frame-metrics.js';
import { makeMockClient, makeScript } from '../flicker/helpers/event-source.js';
import { App } from '../../src/tui/App.js';

/**
 * 重绘机制回归测试。
 * 现场 bug：长时间流式后 ink 增量渲染的快照与终端发散（表格底边框被
 * 后续文字覆盖且冻结不愈）。对策：
 * 1. Ctrl+L 手动完整重绘（writeToStdout → log.clear + restoreLastOutput）
 * 2. turn 结束自动全量重绘，自愈流式期间累积的发散
 */

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('Ctrl+L 触发完整重绘（擦除 + 全量重写，无全清）', async () => {
  const client = makeMockClient();
  const app = renderInk(React.createElement(App, {
    client, sessionId: 'sess_test',
    initialMessages: [{ role: 'user', text: '重绘标记REDRAW' }],
  }));
  await flushFrames(100);
  app.stdout.frames.length = 0;

  app.stdin.write('\x0c'); // Ctrl+L
  await flushFrames(100);

  const m = measureFrames(app.stdout.frames);
  expect(m.eraseLinesTotal).toBeGreaterThan(0); // 有整区擦除
  expect(m.fullClearCount).toBe(0);             // 但不走 ESC[2J 全清
  expect(app.stdout.frames.join('')).toContain('重绘标记REDRAW'); // 内容完整重写
  app.unmount();
});

test('turn 结束自动完整重绘（自愈发散）', async () => {
  const client = makeMockClient();
  const app = renderInk(React.createElement(App, {
    client, sessionId: 'sess_test',
    initialMessages: [{ role: 'user', text: '自愈标记HEAL' }],
  }));
  await flushFrames(100);

  app.stdout.frames.length = 0;
  // turn 各阶段之间推进时钟，让 running 状态真实落地为独立渲染
  await makeScript(client).turnStart(1).run();
  await flushFrames(100);
  await makeScript(client).textDelta('工作中', { mid: 'm1' }).run();
  await flushFrames(100);
  await makeScript(client).turnComplete(1).run();
  await flushFrames(300);

  // turn 结束后的自动重绘：应出现 擦除+全量重写
  const m = measureFrames(app.stdout.frames);
  expect(m.eraseLinesTotal).toBeGreaterThan(0);
  expect(app.stdout.frames.join('')).toContain('自愈标记HEAL');
  app.unmount();
});
