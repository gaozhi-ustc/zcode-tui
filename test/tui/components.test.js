import { test, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { ToolUse } from '../../src/tui/components/ToolUse.js';
import { PermissionDialog } from '../../src/tui/components/PermissionDialog.js';
import { parseEvent } from '../../src/zcode-client.js';

// === parseEvent 事件解析（基于真实 app-server 抓包格式，2026-07-16）===

test('parseEvent 解析 turn.started', () => {
  const raw = {
    method: 'session/event',
    params: { type: 'turn.started', payload: { turnNumber: 1, input: 'hi', queryId: 'q1' } }
  };
  const evt = parseEvent(raw);
  expect(evt.type).toBe('turn-start');
  expect(evt.input).toBe('hi');
});

test('parseEvent 解析 turn.completed（含 usage）', () => {
  const raw = {
    method: 'session/event',
    params: { type: 'turn.completed', payload: { response: 'ok', usage: { inputTokens: 100, outputTokens: 20 }, duration: 800 } }
  };
  const evt = parseEvent(raw);
  expect(evt.type).toBe('turn-complete');
  expect(evt.usage.inputTokens).toBe(100);
});

test('parseEvent 解析 model.streaming text_delta', () => {
  const raw = {
    method: 'session/event',
    params: { type: 'model.streaming', payload: { kind: 'text_delta', delta: 'hello', assistantMessageId: 'msg-1' } }
  };
  const evt = parseEvent(raw);
  expect(evt.type).toBe('text');
  expect(evt.text).toBe('hello');
  expect(evt.assistantMessageId).toBe('msg-1');
});

test('parseEvent 解析 model.streaming tool_call', () => {
  const raw = {
    method: 'session/event',
    params: { type: 'model.streaming', payload: { kind: 'tool_call', toolName: 'Bash', toolCallId: 'call-1', input: { command: 'ls' }, assistantMessageId: 'msg-1' } }
  };
  const evt = parseEvent(raw);
  expect(evt.type).toBe('tool-call');
  expect(evt.toolName).toBe('Bash');
  expect(evt.toolInput.command).toBe('ls');
  expect(evt.toolCallId).toBe('call-1');
});

test('parseEvent 解析 tool.updated scheduled', () => {
  const raw = {
    method: 'session/event',
    params: { type: 'tool.updated', payload: { kind: 'scheduled', toolName: 'Bash', toolCallId: 'call-1' } }
  };
  const evt = parseEvent(raw);
  expect(evt.type).toBe('tool-call');
  expect(evt.phase).toBe('scheduled');
});

test('parseEvent 解析 tool.updated started', () => {
  const raw = {
    method: 'session/event',
    params: { type: 'tool.updated', payload: { kind: 'started', toolName: 'Bash', toolCallId: 'call-1', startedAt: 123 } }
  };
  const evt = parseEvent(raw);
  expect(evt.type).toBe('tool-call');
  expect(evt.phase).toBe('started');
});

test('parseEvent 解析 tool.updated result', () => {
  const raw = {
    method: 'session/event',
    params: { type: 'tool.updated', payload: { kind: 'result', toolCallId: 'call-1', toolName: 'Bash', result: { success: true, content: 'done' }, duration: 100 } }
  };
  const evt = parseEvent(raw);
  expect(evt.type).toBe('tool-result');
  expect(evt.result.content).toBe('done');
  expect(evt.error).toBe(false);
});

test('parseEvent 解析 tool.updated batch', () => {
  const raw = {
    method: 'session/event',
    params: { type: 'tool.updated', payload: { kind: 'batch', toolCallIds: ['call-1'], successCount: 1, errorCount: 0 } }
  };
  const evt = parseEvent(raw);
  expect(evt.type).toBe('tool-batch-complete');
  expect(evt.successCount).toBe(1);
});

test('parseEvent 解析 session.updated usage', () => {
  const raw = {
    method: 'session/event',
    params: { type: 'session.updated', payload: { usage: { inputTokens: 500, outputTokens: 50 }, stopReason: 'end_turn' } }
  };
  const evt = parseEvent(raw);
  expect(evt.type).toBe('usage');
  expect(evt.usage.inputTokens).toBe(500);
});

test('parseEvent 解析 permission 事件', () => {
  const raw = {
    method: 'interaction/requestPermission',
    params: { requestId: 'req-1', toolName: 'Bash', input: { command: 'rm file' } }
  };
  const evt = parseEvent(raw);
  expect(evt.type).toBe('permission');
  expect(evt.requestId).toBe('req-1');
  expect(evt.toolName).toBe('Bash');
});

// === ToolUse 组件 ===

test('ToolUse 渲染进行中的工具调用', () => {
  const { lastFrame } = render(React.createElement(ToolUse, {
    toolName: 'Bash', toolInput: { command: 'ls -la' }, result: null, streaming: true
  }));
  expect(lastFrame()).toContain('Bash');
  expect(lastFrame()).toContain('ls -la');
});

test('ToolUse 渲染成功的工具结果', () => {
  const { lastFrame } = render(React.createElement(ToolUse, {
    toolName: 'Read', toolInput: { file_path: '/a/b.txt' }, result: { success: true, content: 'file content' }, streaming: false
  }));
  const f = lastFrame();
  expect(f).toContain('Read');
  expect(f).toContain('✓');
});

test('ToolUse 渲染错误的工具结果', () => {
  const { lastFrame } = render(React.createElement(ToolUse, {
    toolName: 'Bash', toolInput: { command: 'false' }, result: 'command failed', error: true, streaming: false
  }));
  expect(lastFrame()).toContain('✗');
  expect(lastFrame()).toContain('command failed');
});

// === PermissionDialog 组件 ===

test('PermissionDialog 渲染工具名和选项', () => {
  const { lastFrame } = render(React.createElement(PermissionDialog, {
    toolName: 'Bash', detail: 'rm file.txt', onDecide: () => {}
  }));
  const f = lastFrame();
  expect(f).toContain('Bash');
  expect(f).toContain('允许');
  expect(f).toContain('拒绝');
});

test('PermissionDialog 显示队列序号', () => {
  const { lastFrame } = render(React.createElement(PermissionDialog, {
    toolName: 'Edit', detail: '编辑文件', queueIndex: 2, queueTotal: 5, onDecide: () => {}
  }));
  expect(lastFrame()).toContain('[2/5]');
});
