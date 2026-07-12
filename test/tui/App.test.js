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

test('InputBox 渲染提示符', () => {
  const { lastFrame } = render(React.createElement(InputBox, { onSubmit: () => {} }));
  expect(lastFrame()).toContain('>');
});

function makeMockClient() {
  const handlers = {};
  return {
    on: (evt, fn) => { handlers[evt] = fn; },
    _emit: (evt, data) => handlers[evt] && handlers[evt](data),
    sendMessage: async () => 'ok',
    createSession: async () => 'sess_test',
    subscribe: async () => 'ok',
    isConnected: () => true
  };
}

test('App 渲染并发送用户输入', async () => {
  const client = makeMockClient();
  let sent = null;
  client.sendMessage = async (sid, content) => { sent = content; };
  const { lastFrame, stdin } = render(React.createElement(App, { client, sessionId: 'sess_test' }));
  // 输入文字并回车
  stdin.write('hello world');
  stdin.write('\r');
  await new Promise(r => setTimeout(r, 50));
  expect(sent).toBe('hello world');
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
