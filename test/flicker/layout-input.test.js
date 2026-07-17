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

  app.stdin.write('y'); // 批准 → 对话框关闭（PermissionDialog: 'y'/'Y'/Enter = yes）
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
  app.stdin.write('s'); // '@' 单独前缀为空无建议；'@s' 触发 getFileSuggestions('s')
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

// === 优化靶点已达标：实测每击键恰好 1 帧（ink 30fps throttle 窗口内合并 useEffect 二次 commit）。
// 按 thresholds.js 约定从 test.fails 提升为常规守护，current.keystrokeMaxFrames 同步提升为 21。 ===
test('S7-target: 20 击键 ≤21 帧（靶点已达标，转为守护）', async () => {
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
