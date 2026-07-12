import { test, expect, afterEach } from 'vitest';
import { ZCodeClient } from '../src/zcode-client.js';
import { spawn } from 'node:child_process';
import { once, EventEmitter } from 'node:events';

// 模拟 app-server:一个读 stdin 写 stdout 的 node 脚本
const MOCK_SERVER = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'session/list') {
    process.stdout.write(JSON.stringify({id: msg.id, result: {sessions: [{sessionId: 'sess_mock'}]}}) + '\\n');
  }
  // 不识别的方法回错误
  else if (msg.method) {
    process.stdout.write(JSON.stringify({id: msg.id, error: {code: -32601, message: 'mock: ' + msg.method}}) + '\\n');
  }
});
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
