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
