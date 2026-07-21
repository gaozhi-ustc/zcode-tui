import React from 'react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderInk, flushFrames } from '../flicker/helpers/test-stdout.js';
import { App } from '../../src/tui/App.js';

/**
 * 连续对话框可答性回归测试。
 * 现场 bug：第一个提问回答后，第二个相同的提问对话框弹出，
 * 但 Enter/Esc 完全无效 —— QuestionDialog 的 respondedRef（useRef(false)）
 * 在 React 复用组件实例时持续为 true（组件同类型同位置，未重挂载）。
 * 修复：对话框按 rpcId 作 key 强制重挂载。
 */

function makeClient() {
  const handlers = {};
  const responded = [];
  const modeChanges = [];
  return {
    on: (evt, fn) => { handlers[evt] = fn; },
    off: () => {},
    removeListener: () => {},
    _emit: (evt, data) => handlers[evt] && handlers[evt](data),
    sendMessage: async () => 'ok',
    stop: async () => 'ok',
    respondToServer: (id, result) => { responded.push({ id, result }); },
    responded,
    setMode: async (sessionId, mode) => { modeChanges.push({ sessionId, mode }); },
    modeChanges,
    createSession: async () => 'sess_test',
    subscribe: async () => 'ok',
    isConnected: () => true,
  };
}

function questionRequest(id, q) {
  return {
    jsonrpc: '2.0', id,
    method: 'interaction/requestUserInput',
    params: { requestId: `r${id}`, questions: [{ question: q, options: [{ label: 'Approve' }, { label: 'Reject' }] }] },
  };
}

function permissionRequest(id, toolName) {
  return {
    jsonrpc: '2.0', id,
    method: 'interaction/requestPermission',
    params: { toolName, input: { command: 'ls' }, reason: 'test', riskLevel: 'low' },
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

// ink 的渲染 throttle 与 fake timers 的交互对大步进不可靠：
// 分 3 小步推进，确保对话框帧落地（其 useInput 注册）后再注入按键
async function settle() {
  for (let i = 0; i < 3; i++) await flushFrames(60);
}


test('连续两个提问：第二个对话框的 Enter 必须有效', async () => {
  const client = makeClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await settle();

  client._emit('server-request', questionRequest(101, '问题一?'));
  await settle();
  app.stdin.write('\r'); // Enter
  await flushFrames(60);
  // 确认后对话框必须立即消失（单帧内），不等 server/模型反馈
  // （回显消息 'user: 问题一?: Approve' 会保留问题文本，故检查对话框边框）
  expect(app.stdout.frames.at(-1)).not.toContain('╭');
  await settle();
  expect(client.responded.map(r => r.id)).toContain(101);

  client._emit('server-request', questionRequest(102, '问题二?'));
  await settle();
  app.stdin.write('\r'); // 第二个 Enter —— 修复前被 respondedRef 吞掉
  await settle();
  expect(client.responded.map(r => r.id)).toContain(102);
  app.unmount();
});

test('连续两个权限请求：第二个对话框的 y 必须有效', async () => {
  const client = makeClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await settle();

  client._emit('server-request', permissionRequest(201, 'Bash'));
  await settle();
  app.stdin.write('y');
  await settle();
  expect(client.responded.map(r => r.id)).toContain(201);

  client._emit('server-request', permissionRequest(202, 'Read'));
  await settle();
  app.stdin.write('y'); // 修复前被 decidedRef 吞掉
  await settle();
  expect(client.responded.map(r => r.id)).toContain(202);
  app.unmount();
});

test('/mode yolo 后权限请求必须自动批准，不弹授权对话框', async () => {
  const client = makeClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await settle();

  app.stdin.write('/mode yolo');
  await settle();
  app.stdin.write('\r');
  await settle();
  expect(client.modeChanges).toEqual([{ sessionId: 'sess_test', mode: 'yolo' }]);

  client._emit('server-request', permissionRequest(501, 'Bash'));
  await settle();
  expect(client.responded).toEqual([{ id: 501, result: { decision: 'allow' } }]);
  expect(app.stdout.frames.at(-1)).not.toContain('权限请求');
  app.unmount();
});

test('server state mode=yolo 后权限请求必须自动批准', async () => {
  const client = makeClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await settle();

  client._emit('event', { type: 'state', patch: { mode: { current: 'yolo' } } });
  await settle();
  client._emit('server-request', permissionRequest(502, 'Bash'));
  await settle();

  expect(client.responded).toEqual([{ id: 502, result: { decision: 'allow' } }]);
  expect(app.stdout.frames.at(-1)).not.toContain('权限请求');
  app.unmount();
});

test('broker 重播（每次新 id）：同内容权限请求队列不膨胀，回答发给最新 id', async () => {
  // zcode.cjs 实锤：broker 重播时每次生成新 rpcId（server-${nextId++}，
  // 指数退避），回答任一 id 都解析整个逻辑请求。客户端必须按内容去重，
  // 否则队列积压成 [1/3929]（现场）。
  const client = makeClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await settle();

  client._emit('server-request', permissionRequest(301, 'Bash'));
  client._emit('server-request', permissionRequest(302, 'Bash'));
  client._emit('server-request', permissionRequest(303, 'Bash'));
  await settle();
  // 队列不得膨胀（[1/3] 徽标不应出现）
  expect(app.stdout.frames.at(-1)).not.toContain('[1/3]');

  app.stdin.write('y');
  await settle();
  // 回答发给最新存活的 id（303），且只发一次
  expect(client.responded.map(r => r.id)).toEqual([303]);
  app.unmount();
});

test('broker 重播（每次新 id）：同内容提问队列不膨胀', async () => {
  const client = makeClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await settle();

  client._emit('server-request', questionRequest(401, '问题重复?'));
  client._emit('server-request', questionRequest(402, '问题重复?'));
  client._emit('server-request', questionRequest(403, '问题重复?'));
  await settle();
  app.stdin.write('\r');
  await settle();
  expect(client.responded.map(r => r.id)).toEqual([403]);
  app.unmount();
});

test('重 announce 竞态：回答后 1s 内重发同 id 请求不得复活对话框（现场死锁）', async () => {
  // server 的 interaction broker 每 1s 重播未决请求（reannounceIntervalMs=1000）。
  // 现场：Enter 回答（出队+响应已发）后，同 id 重播在渲染前重新入队，
  // 对话框从未卸载（respondedRef 卡 true）→ 永久卡死。
  const client = makeClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await settle();

  client._emit('server-request', questionRequest(101, '问题一?'));
  await settle();
  app.stdin.write('\r'); // Enter：回答
  // 关键：在同一 flush 窗口内重播同 id 请求（竞态复现）
  client._emit('server-request', questionRequest(101, '问题一?'));
  await settle();

  // 对话框必须消失且不再复活；响应只发一次
  expect(app.stdout.frames.at(-1)).not.toContain('╭');
  expect(client.responded.filter(r => r.id === 101).length).toBe(1);

  // 再按 Enter 也不应有任何效果（对话框已不存在）
  app.stdin.write('\r');
  await settle();
  expect(client.responded.filter(r => r.id === 101).length).toBe(1);
  app.unmount();
});

test('重放的已响应请求：出队但不重复回复（防止卡死）', async () => {
  const client = makeClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await settle();

  client._emit('server-request', questionRequest(101, '问题一?'));
  await settle();
  app.stdin.write('\r');
  await settle();
  expect(client.responded.filter(r => r.id === 101).length).toBe(1);

  // server 重播同一 rpcId（broker reannounce / 重连重发）：直接忽略，不再弹出
  client._emit('server-request', questionRequest(101, '问题一?'));
  await settle();
  expect(app.stdout.frames.at(-1)).not.toContain('╭');
  expect(client.responded.filter(r => r.id === 101).length).toBe(1);
  app.unmount();
});
