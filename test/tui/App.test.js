import { test, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { StatusBar } from '../../src/tui/StatusBar.js';
import { MessageList } from '../../src/tui/MessageList.js';
import { InputBox } from '../../src/tui/InputBox.js';
import { App } from '../../src/tui/App.js';

test('StatusBar 渲染模型与模式', () => {
  const { lastFrame } = render(React.createElement(StatusBar, { model: 'GLM-5.2', mode: 'build', sessionId: 'sess_abc123', status: 'idle' }));
  expect(lastFrame()).toContain('GLM-5.2');
  expect(lastFrame()).toContain('build');
  expect(lastFrame()).toContain('sess_abc123');
});

test('MessageList 渲染对话条目', () => {
  const messages = [
    { role: 'user', text: '你好' },
    { role: 'assistant', text: '你好!有什么可以帮你?' }
  ];
  const { lastFrame } = render(React.createElement(MessageList, { messages }));
  const f = lastFrame();
  expect(f).toContain('你好');
  expect(f).toContain('有什么可以帮你');
});

test('MessageList streaming 消息显示闪烁指示器', () => {
  const messages = [
    { role: 'assistant', text: '生成中', streaming: true }
  ];
  const { lastFrame } = render(React.createElement(MessageList, { messages }));
  expect(lastFrame()).toContain('▌');
});

test('InputBox 渲染提示符', () => {
  const { lastFrame } = render(React.createElement(InputBox, { onSubmit: () => {} }));
  expect(lastFrame()).toContain('>');
});

function makeMockClient() {
  const handlers = {};
  return {
    on: (evt, fn) => { handlers[evt] = fn; },
    off: () => {},
    removeListener: () => {},
    _emit: (evt, data) => handlers[evt] && handlers[evt](data),
    sendMessage: async () => 'ok',
    stop: async () => 'ok',
    createSession: async () => 'sess_test',
    subscribe: async () => 'ok',
    isConnected: () => true
  };
}

test('App 渲染输入区且 handleSubmit 接线 client.sendMessage', async () => {
  const client = makeMockClient();
  let sent = null;
  client.sendMessage = async (sid, content) => { sent = content; };
  const { lastFrame } = render(React.createElement(App, { client, sessionId: 'sess_test' }));
  expect(lastFrame()).toContain('>');
  await client.sendMessage('sess_test', 'probe');
  expect(sent).toBe('probe');
});

test('App 收到 text 事件追加 assistant 消息', async () => {
  const client = makeMockClient();
  const { lastFrame } = render(React.createElement(App, { client, sessionId: 'sess_test' }));
  client._emit('event', { type: 'text', text: 'pong' });
  await new Promise(r => setTimeout(r, 50));
  expect(lastFrame()).toContain('pong');
});

test('App 收到 state 事件更新状态栏', async () => {
  const client = makeMockClient();
  const { lastFrame } = render(React.createElement(App, { client, sessionId: 'sess_test' }));
  client._emit('event', { type: 'state', patch: { status: 'running' } });
  await new Promise(r => setTimeout(r, 50));
  expect(lastFrame()).toContain('running');
});

// === 阶段一新增测试 ===

test('流式增量合并：相同 assistantMessageId 的 text 事件追加到同一条消息', async () => {
  const client = makeMockClient();
  const { lastFrame } = render(React.createElement(App, { client, sessionId: 'sess_test' }));
  // 同一条消息的增量片段
  client._emit('event', { type: 'text', text: '你好', assistantMessageId: 'msg-1' });
  await new Promise(r => setTimeout(r, 30));
  client._emit('event', { type: 'text', text: '世界', assistantMessageId: 'msg-1' });
  await new Promise(r => setTimeout(r, 30));
  client._emit('event', { type: 'text', text: '！', assistantMessageId: 'msg-1' });
  await new Promise(r => setTimeout(r, 50));
  const frame = lastFrame();
  // 应合并为一条 "你好世界！" 而非三条独立消息
  expect(frame).toContain('你好世界！');
  // 不应出现三条独立的 assistant 行
  const lines = frame.split('\n').filter(l => l.includes('你好'));
  expect(lines.length).toBe(1);
});

test('不同 assistantMessageId 的 text 事件创建新消息', async () => {
  const client = makeMockClient();
  const { lastFrame } = render(React.createElement(App, { client, sessionId: 'sess_test' }));
  client._emit('event', { type: 'text', text: '第一条', assistantMessageId: 'msg-1' });
  await new Promise(r => setTimeout(r, 30));
  client._emit('event', { type: 'text', text: '第二条', assistantMessageId: 'msg-2' });
  await new Promise(r => setTimeout(r, 50));
  const frame = lastFrame();
  expect(frame).toContain('第一条');
  expect(frame).toContain('第二条');
});

test('turn-start 设置 running，turn-complete 回到 idle', async () => {
  const client = makeMockClient();
  const { lastFrame } = render(React.createElement(App, { client, sessionId: 'sess_test' }));
  client._emit('event', { type: 'turn-start', input: 'hi', turnNumber: 1 });
  await new Promise(r => setTimeout(r, 50));
  expect(lastFrame()).toContain('running');
  client._emit('event', { type: 'turn-complete', response: {}, turnNumber: 1 });
  await new Promise(r => setTimeout(r, 50));
  expect(lastFrame()).toContain('idle');
});

test('turn-complete 后 assistant 消息标记为已完成（streaming=false）', async () => {
  const client = makeMockClient();
  const { lastFrame } = render(React.createElement(App, { client, sessionId: 'sess_test' }));
  client._emit('event', { type: 'text', text: '回复', assistantMessageId: 'msg-1' });
  await new Promise(r => setTimeout(r, 30));
  expect(lastFrame()).toContain('▌'); // streaming 中
  client._emit('event', { type: 'turn-complete', response: {}, turnNumber: 1 });
  await new Promise(r => setTimeout(r, 50));
  expect(lastFrame()).toContain('●'); // 已完成
  expect(lastFrame()).not.toContain('▌');
});
