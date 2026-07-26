import React from 'react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderInk, flushFrames } from '../flicker/helpers/test-stdout.js';
import { makeMockClient, makeScript } from '../flicker/helpers/event-source.js';
import { App } from '../../src/tui/App.js';

/**
 * 消息排队（pending queue）回归测试。
 * 现场：turn 运行中用户发新消息，server 直接拒绝
 * "A prompt is already running for this session"，体验很差。
 * 对标 Claude Code：运行中新消息进入待执行队列，turn 结束后自动依次发送。
 */

function makeClient() {
  const base = makeMockClient();
  base.sent = [];
  // 模拟 server 行为：收到 prompt 即开始新 turn（驱动 awaitingTurnStart 解锁）
  base.sendMessage = async (sid, content) => {
    base.sent.push(content);
    base._emit('event', { jsonrpc: '2.0', method: 'session/event', params: { type: 'turn.started', payload: { turnNumber: base.sent.length } } });
    return 'ok';
  };
  return base;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('运行中发消息：进入队列不报错，turn 结束后自动发送', async () => {
  const client = makeClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await flushFrames(100);

  await makeScript(client).turnStart(1).run();
  await flushFrames(50);

  // 运行中输入新消息（直接调用 InputBox 的 onSubmit 路径：stdin 输入 + Enter）
  app.stdin.write('先忙完再看这个');
  await flushFrames(50);
  app.stdin.write('\r');
  await flushFrames(100);

  // 不报错、不发送
  expect(client.sent).toEqual([]);
  expect(app.stdout.frames.join('')).not.toContain('already running');
  // 有排队提示
  expect(app.stdout.frames.join('')).toContain('排队');

  // turn 完成 → 自动发送
  await makeScript(client).turnComplete(1).run();
  await flushFrames(200);
  expect(client.sent).toEqual(['先忙完再看这个']);
  app.unmount();
});

test('多条消息按序执行：每 turn 结束发一条', async () => {
  const client = makeClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await flushFrames(100);

  await makeScript(client).turnStart(1).run();
  await flushFrames(50);
  for (const t of ['任务A', '任务B']) {
    app.stdin.write(t);
    await flushFrames(30);
    app.stdin.write('\r');
    await flushFrames(50);
  }
  expect(client.sent).toEqual([]);

  // 第一个 turn 结束 → 发任务A（任务B 继续排队，不一起发）
  await makeScript(client).turnComplete(1).run();
  await flushFrames(200);
  expect(client.sent).toEqual(['任务A']);

  // 第二个 turn 结束 → 发任务B
  await makeScript(client).turnComplete(2).run();
  await flushFrames(200);
  expect(client.sent).toEqual(['任务A', '任务B']);
  app.unmount();
});

test('斜杠命令运行中立即执行，不进队列', async () => {
  const client = makeClient();
  client.compact = async () => 'ok';
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await flushFrames(100);

  await makeScript(client).turnStart(1).run();
  await flushFrames(50);
  app.stdin.write('/compact');
  await flushFrames(30);
  app.stdin.write('\r');
  await flushFrames(100);

  // /compact 立即走了 slash 路径（未排队、未 sendMessage）
  expect(client.sent).toEqual([]);
  expect(app.stdout.frames.join('')).not.toContain('排队');
  app.unmount();
});
