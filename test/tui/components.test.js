import { test, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { ToolUse } from '../../src/tui/components/ToolUse.js';
import { PermissionDialog } from '../../src/tui/components/PermissionDialog.js';
import { parseEvent } from '../../src/zcode-client.js';

// === parseEvent 事件解析（基于真实 app-server params.type 格式）===

test('parseEvent 解析 tool_call_started', () => {
  const raw = {
    method: 'session/event',
    params: { type: 'tool_call_started', payload: { toolCallId: 'tc-1', toolName: 'Bash', startedAt: 123 } }
  };
  const evt = parseEvent(raw);
  expect(evt.type).toBe('tool-call');
  expect(evt.toolName).toBe('Bash');
  expect(evt.toolCallId).toBe('tc-1');
  expect(evt.phase).toBe('started');
});

test('parseEvent 解析 tool_call_progress', () => {
  const raw = {
    method: 'session/event',
    params: { type: 'tool_call_progress', payload: { toolCallId: 'tc-1', toolName: 'Bash', elapsedMs: 500, stdoutTail: 'output...' } }
  };
  const evt = parseEvent(raw);
  expect(evt.type).toBe('tool-progress');
  expect(evt.toolCallId).toBe('tc-1');
  expect(evt.elapsedMs).toBe(500);
});

test('parseEvent 解析 tool_call_result', () => {
  const raw = {
    method: 'session/event',
    params: { type: 'tool_call_result', payload: { toolCallId: 'tc-1', result: { success: true, content: 'done' }, duration: 100 } }
  };
  const evt = parseEvent(raw);
  expect(evt.type).toBe('tool-result');
  expect(evt.toolCallId).toBe('tc-1');
  expect(evt.result.content).toBe('done');
});

test('parseEvent 解析 tool_call_error', () => {
  const raw = {
    method: 'session/event',
    params: { type: 'tool_call_error', payload: { toolCallId: 'tc-1', error: 'failed' } }
  };
  const evt = parseEvent(raw);
  expect(evt.type).toBe('tool-result');
  expect(evt.error).toBe(true);
  expect(evt.result).toBe('failed');
});

test('parseEvent 解析 model_streaming（文本流式）', () => {
  const raw = {
    method: 'session/event',
    params: { type: 'model_streaming', payload: { content: 'hello', querySource: 'main_turn' } }
  };
  const evt = parseEvent(raw);
  expect(evt.type).toBe('text');
  expect(evt.text).toBe('hello');
});

test('parseEvent 解析 turn_started', () => {
  const raw = {
    method: 'session/event',
    params: { type: 'turn_started', payload: { input: 'hi', turnNumber: 1 } }
  };
  const evt = parseEvent(raw);
  expect(evt.type).toBe('turn-start');
});

test('parseEvent 解析 turn_complete', () => {
  const raw = {
    method: 'session/event',
    params: { type: 'turn_complete', payload: { response: {}, turnNumber: 1 } }
  };
  const evt = parseEvent(raw);
  expect(evt.type).toBe('turn-complete');
});

test('parseEvent 解析 permission 事件', () => {
  const raw = {
    method: 'interaction/requestPermission',
    params: { requestId: 'req-1', toolName: 'Bash', detail: 'rm -rf /tmp/x' }
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
  const f = lastFrame();
  expect(f).toContain('Bash');
  expect(f).toContain('ls -la');
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
  const f = lastFrame();
  expect(f).toContain('✗');
  expect(f).toContain('command failed');
});

test('ToolUse 渲染进度信息（耗时）', () => {
  const { lastFrame } = render(React.createElement(ToolUse, {
    toolName: 'Bash', toolInput: { command: 'sleep 5' }, result: null, streaming: true, elapsedMs: 3200
  }));
  expect(lastFrame()).toContain('3.2s');
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
  expect(f).toContain('本工具总允许');
});

test('PermissionDialog 显示队列序号', () => {
  const { lastFrame } = render(React.createElement(PermissionDialog, {
    toolName: 'Edit', detail: '编辑文件', queueIndex: 2, queueTotal: 5, onDecide: () => {}
  }));
  expect(lastFrame()).toContain('[2/5]');
});
