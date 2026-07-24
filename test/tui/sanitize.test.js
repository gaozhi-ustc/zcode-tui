import React from 'react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { sanitizeText } from '../../src/tui/sanitize.js';
import { renderInk, flushFrames } from '../flicker/helpers/test-stdout.js';
import { makeMockClient, makeScript } from '../flicker/helpers/event-source.js';
import { App } from '../../src/tui/App.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('sanitizeText 处理 \\r 与 ANSI', () => {
  // \r 展开为换行（远程 pty 捕获的典型形态）
  expect(sanitizeText('$ zcode\rnode:internal/modules')).toBe('$ zcode\nnode:internal/modules');
  expect(sanitizeText('a\r\nb')).toBe('a\nb');
  // ANSI 序列去除
  expect(sanitizeText('\x1b[31mred\x1b[39m')).toBe('red');
  // 干净文本原样返回
  expect(sanitizeText('正常文本')).toBe('正常文本');
  expect(sanitizeText('')).toBe('');
  expect(sanitizeText(null)).toBe(null);
});

test('含 \\r 的流式文本渲染后不再产生混叠（现场回归）', async () => {
  const client = makeMockClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await flushFrames(100);

  await makeScript(client)
    .turnStart(1)
    .textDelta('执行结果：$ zcode\rnode:internal/modules/cjs/loader:1404', { mid: 'm1' })
    .turnComplete(1)
    .run();
  await flushFrames(200);

  const out = app.stdout.frames.join('');
  // 渲染输出中不得再有裸 \r（会产生终端覆盖混叠）
  expect(out).not.toContain('$ zcode\rnode:internal');
  // 两个片段都应可见（展开为独立行）
  expect(out).toContain('node:internal/modules/cjs/loader:1404');
  app.unmount();
});

test('工具结果中的 \\r 与 ANSI 在展示前被净化', async () => {
  const client = makeMockClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await flushFrames(100);

  await makeScript(client)
    .turnStart(1)
    .toolCall('Bash', { command: 'zcode' }, 't1')
    .toolResult('t1', { success: false, content: '\x1b[31m错误提示\x1b[39m\rnode:internal/loader' })
    .turnComplete(1)
    .run();
  await flushFrames(200);

  const out = app.stdout.frames.join('');
  expect(out).not.toContain('错误提示\rnode');
  expect(out).toContain('错误提示');
  expect(out).toContain('node:internal/loader');
  app.unmount();
});
