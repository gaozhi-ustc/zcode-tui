import { test, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { StatusBar } from '../../src/tui/StatusBar.js';
import { MessageList } from '../../src/tui/MessageList.js';
import { InputBox } from '../../src/tui/InputBox.js';

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
