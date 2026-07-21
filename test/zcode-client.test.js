import { test, expect, afterEach } from 'vitest';
import { ZCodeClient } from '../src/zcode-client.js';
import { spawn } from 'node:child_process';
import { once, EventEmitter } from 'node:events';

// 模拟 app-server:一个读 stdin 写 stdout 的 node 脚本
const MOCK_SERVER = `
const fs = require('node:fs');
const chunk = Buffer.alloc(4096);
let buffer = '';

function handleLine(line) {
  const msg = JSON.parse(line);
  if (msg.method === 'session/list') {
    fs.writeSync(1, JSON.stringify({id: msg.id, result: {sessions: [{sessionId: 'sess_mock'}]}}) + '\\n');
  }
  // 不识别的方法回错误
  else if (msg.method) {
    fs.writeSync(1, JSON.stringify({id: msg.id, error: {code: -32601, message: 'mock: ' + msg.method}}) + '\\n');
  }
}

for (;;) {
  const bytesRead = fs.readSync(0, chunk, 0, chunk.length, null);
  if (bytesRead === 0) break;
  buffer += chunk.toString('utf8', 0, bytesRead);
  let idx;
  while ((idx = buffer.indexOf('\\n')) !== -1) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (line) handleLine(line);
  }
}
`;

let clients = [];
afterEach(async () => {
  for (const c of clients) await c.disconnect().catch(() => {});
  clients = [];
});

test('connect 启动子进程并就绪', async () => {
  const c = new ZCodeClient({ command: 'node', args: ['-e', MOCK_SERVER] });
  clients.push(c);
  await c.connect();
  expect(c.isConnected()).toBe(true);
});

test('send 按 id 匹配响应', async () => {
  const c = new ZCodeClient({ command: 'node', args: ['-e', MOCK_SERVER] });
  clients.push(c);
  await c.connect();
  const result = await c.send('session/list', {});
  expect(result.sessions[0].sessionId).toBe('sess_mock');
});

test('send 收到 error 时 reject', async () => {
  const c = new ZCodeClient({ command: 'node', args: ['-e', MOCK_SERVER] });
  clients.push(c);
  await c.connect();
  await expect(c.send('unknown/method', {})).rejects.toMatchObject({ code: -32601 });
});

test('子进程退出后 send 立即 reject', async () => {
  const c = new ZCodeClient({ command: 'node', args: ['-e', 'process.exit(0)'] });
  clients.push(c);
  await c.connect();
  await expect(c.send('session/list', {})).rejects.toThrow();
});

import { parseEvent } from '../src/zcode-client.js';

test('parseEvent 把 state.updated 解析为 state 事件', () => {
  const raw = { method: 'state.updated', params: { patch: { status: 'running' }, sessionId: 's1', scope: 'session' } };
  const parsed = parseEvent(raw);
  expect(parsed.type).toBe('state');
  expect(parsed.patch.status).toBe('running');
});

test('parseEvent 把 model.streaming text_delta 解析为 text 事件', () => {
  const raw = { method: 'session/event', params: { type: 'model.streaming', payload: { kind: 'text_delta', delta: 'pong', assistantMessageId: 'msg-1' } } };
  const parsed = parseEvent(raw);
  expect(parsed.type).toBe('text');
  expect(parsed.text).toBe('pong');
});

test('parseEvent 把 turn.completed 解析为 turn-complete', () => {
  const raw = { method: 'session/event', params: { type: 'turn.completed', payload: { response: 'done', turnNumber: 1 } } };
  const parsed = parseEvent(raw);
  expect(parsed.type).toBe('turn-complete');
});

test('parseEvent 未知 payload 归类为 raw', () => {
  const raw = { method: 'session/event', params: { payload: { somethingNew: true } } };
  const parsed = parseEvent(raw);
  expect(parsed.type).toBe('raw');
});
