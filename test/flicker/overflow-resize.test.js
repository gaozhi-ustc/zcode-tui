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
  // Static 架构：历史消息挂载时打印一次进入 scrollback，resize 不重印（ink 不重排 Static）
  expect(app.stdout.frames.join('')).toContain('resize基准消息');
  app.stdout.frames.length = 0;

  app.stdout.resize(80, 30);   // 缩 → 预期 1 次全清
  await flushFrames(100);
  app.stdout.resize(100, 30);  // 扩 → 预期无全清
  await flushFrames(100);
  app.stdout.resize(60, 30);   // 缩 → 预期 1 次全清
  await flushFrames(100);

  const m = measureFrames(app.stdout.frames);
  expect(m.fullClearCount).toBeLessThanOrEqual(budgets.current.resizeMaxFullClears);
  expect(app.frames.join('')).toContain('ZCode'); // 动态区（状态栏）正常重绘

  app.stdout.frames.length = 0;
  app.stdout.resize(60, 30);   // 同尺寸 → 记录帧数（理想为 0）
  await flushFrames(100);
  checkBaseline('s4-resize', { ...m, sameSizeFrames: app.stdout.frames.length });
  app.unmount();
});
