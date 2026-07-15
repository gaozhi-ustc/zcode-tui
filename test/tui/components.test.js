import { test, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { ToolUse } from '../../src/tui/components/ToolUse.js';
import { PermissionDialog } from '../../src/tui/components/PermissionDialog.js';
import { parseEvent } from '../../src/zcode-client.js';

// === parseEvent 工具事件解析 ===

test('parseEvent 解析 tool-call 事件（toolCall 格式）', () => {
  const raw = {
    method: 'session/event',
    params: { payload: { toolCall: { name: 'Bash', input: { command: 'ls -la' }, id: 'tc-1' } } }
  };
  const evt = parseEvent(raw);
  expect(evt.type).toBe('tool-call');
  expect(evt.toolName).toBe('Bash');
  expect(evt.toolInput.command).toBe('ls -la');
  expect(evt.toolCallId).toBe('tc-1');
});

test('parseEvent 解析 tool-call 事件（扁平 toolName 格式）', () => {
  const raw = {
    method: 'session/event',
    params: { payload: { toolName: 'Read', toolInput: { file_path: '/a/b' }, toolCallId: 'tc-2' } }
  };
  const evt = parseEvent(raw);
  expect(evt.type).toBe('tool-call');
  expect(evt.toolName).toBe('Read');
  expect(evt.toolInput.file_path).toBe('/a/b');
});

test('parseEvent 解析 tool-result 事件', () => {
  const raw = {
    method: 'session/event',
    params: { payload: { toolResult: { id: 'tc-1', name: 'Bash', output: 'done', isError: false } } }
  };
  const evt = parseEvent(raw);
  expect(evt.type).toBe('tool-result');
  expect(evt.toolCallId).toBe('tc-1');
  expect(evt.result).toBe('done');
  expect(evt.error).toBe(false);
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

test('ToolUse 渲染进行中的工具调用（闪烁指示器）', () => {
  const { lastFrame } = render(React.createElement(ToolUse, {
    toolName: 'Bash', toolInput: { command: 'ls -la' }, result: null, streaming: true
  }));
  const f = lastFrame();
  expect(f).toContain('Bash');
  expect(f).toContain('ls -la');
});

test('ToolUse 渲染成功的工具结果', () => {
  const { lastFrame } = render(React.createElement(ToolUse, {
    toolName: 'Read', toolInput: { file_path: '/a/b.txt' }, result: 'file content', streaming: false
  }));
  const f = lastFrame();
  expect(f).toContain('Read');
  expect(f).toContain('/a/b.txt');
  expect(f).toContain('file content');
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

// === PermissionDialog 组件 ===

test('PermissionDialog 渲染工具名和选项', () => {
  const { lastFrame } = render(React.createElement(PermissionDialog, {
    toolName: 'Bash', detail: 'rm file.txt', onDecide: () => {}
  }));
  const f = lastFrame();
  expect(f).toContain('Bash');
  expect(f).toContain('rm file.txt');
  expect(f).toContain('允许');
  expect(f).toContain('拒绝');
});
