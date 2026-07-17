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
  // columns:120 —— 默认 100 列下 '▌ ' 前缀(2列) + 49 个全角'词'(98列) 恰好满行，
  // 第 50 字换行使 toContain('词'.repeat(50)) 无法匹配；加宽避免换行干扰内容断言。
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }), { columns: 120 });
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
  expect(app.frames.join('')).toContain('词'.repeat(50));
  checkBaseline('s2-stream-burst', m);
  app.unmount();
});

test('S2b: 流式 markdown —— 已完成块行零变化', async () => {
  const client = makeMockClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await flushFrames(50);
  await makeScript(client)
    .turnStart(1)
    .textDelta('# 标题\n\n第一段内容STABLE。\n\n', { mid: 'm1' })
    .run();
  await flushFrames(100);
  app.stdout.frames.length = 0;

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
