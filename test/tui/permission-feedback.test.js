import React from 'react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderInk, flushFrames } from '../flicker/helpers/test-stdout.js';
import { makeMockClient, makeScript } from '../flicker/helpers/event-source.js';
import { App } from '../../src/tui/App.js';

/**
 * 权限对话框「输入指令」回归测试（对齐 Claude Code 的
 * "No, and tell Claude what to do differently"）：
 * 权限请求到来时，用户可按 t 输入追加指令，随拒绝一起发给 server
 * （{decision:'deny', reason: 指令文本}），让模型据此调整行为。
 */

function makeClient() {
  const base = makeMockClient();
  base.responded = [];
  base.respondToServer = (id, result) => { base.responded.push({ id, result }); };
  return base;
}

function permissionRequest(id, toolName) {
  return {
    jsonrpc: '2.0', id,
    method: 'interaction/requestPermission',
    params: { toolName, input: { command: 'rm -rf /tmp/x' }, reason: 'test', riskLevel: 'medium' },
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('权限对话框显示输入指令选项', async () => {
  const client = makeClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await flushFrames(100);

  await makeScript(client).permissionRequest(42, 'Bash', { command: 'rm -rf /tmp/x' }).run();
  await flushFrames(100);
  const out = app.stdout.frames.join('');
  expect(out).toContain('输入指令');
  app.unmount();
});

test('按 t 输入指令随拒绝发送：deny + reason=指令文本', async () => {
  const client = makeClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await flushFrames(100);

  await makeScript(client).permissionRequest(42, 'Bash', { command: 'rm -rf /tmp/x' }).run();
  await flushFrames(150);

  app.stdin.write('t'); // 进入输入指令模式
  await flushFrames(100);
  expect(app.stdout.frames.join('')).toContain('指令');

  // 输入指令文本（逐字符）后 Enter
  for (const ch of '不要删文件') {
    app.stdin.write(ch);
    await flushFrames(30);
  }
  app.stdin.write('\r');
  await flushFrames(150);

  expect(client.responded.length).toBe(1);
  expect(client.responded[0].id).toBe(42);
  expect(client.responded[0].result.decision).toBe('deny');
  expect(client.responded[0].result.reason).toBe('不要删文件');
  // 对话框已关闭（末帧无边框）
  expect(app.stdout.frames.at(-1)).not.toContain('╭');
  app.unmount();
});

test('输入指令模式 Esc 返回选项，不误拒绝', async () => {
  const client = makeClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await flushFrames(100);

  await makeScript(client).permissionRequest(42, 'Bash', { command: 'rm -rf /tmp/x' }).run();
  await flushFrames(150);
  app.stdin.write('t');
  await flushFrames(100);
  app.stdin.write('\x1b'); // Esc 返回
  await flushFrames(100);
  expect(client.responded.length).toBe(0);
  // 回到选项界面，仍可正常允许
  app.stdin.write('y');
  await flushFrames(150);
  expect(client.responded.length).toBe(1);
  expect(client.responded[0].result.decision).toBe('allow');
  app.unmount();
});
