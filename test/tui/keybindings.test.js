import { test, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { keyToKeystroke, DEFAULT_BINDINGS } from '../../src/tui/keybindings.js';
import { StatusBar } from '../../src/tui/StatusBar.js';

// === keyToKeystroke 按键识别 ===

test('keyToKeystroke 识别 Ctrl+C', () => {
  expect(keyToKeystroke('\x03', { ctrl: true })).toBe('ctrl+c');
});

test('keyToKeystroke 识别方向键', () => {
  expect(keyToKeystroke('', { upArrow: true })).toBe('up');
  expect(keyToKeystroke('', { downArrow: true })).toBe('down');
  expect(keyToKeystroke('', { leftArrow: true })).toBe('left');
  expect(keyToKeystroke('', { rightArrow: true })).toBe('right');
});

test('keyToKeystroke 识别 Shift+Enter', () => {
  expect(keyToKeystroke('\r', { return: true, shift: true })).toBe('shift+return');
});

test('keyToKeystroke 识别 Escape', () => {
  expect(keyToKeystroke('\x1b', { escape: true })).toBe('escape');
});

test('keyToKeystroke 识别普通字符', () => {
  expect(keyToKeystroke('a', {})).toBe('a');
  expect(keyToKeystroke('y', {})).toBe('y');
});

test('keyToKeystroke 识别 Ctrl+L/O/T', () => {
  expect(keyToKeystroke('l', { ctrl: true })).toBe('ctrl+l');
  expect(keyToKeystroke('o', { ctrl: true })).toBe('ctrl+o');
  expect(keyToKeystroke('t', { ctrl: true })).toBe('ctrl+t');
});

test('DEFAULT_BINDINGS 包含各上下文的绑定', () => {
  expect(DEFAULT_BINDINGS.Global['ctrl+c']).toBe('app:interrupt');
  expect(DEFAULT_BINDINGS.Chat['return']).toBe('chat:submit');
  expect(DEFAULT_BINDINGS.Confirmation['y']).toBe('confirm:yes');
  expect(DEFAULT_BINDINGS.Scroll['pageup']).toBe('scroll:up');
});

// === StatusBar 增强 ===

test('StatusBar 显示 workspace 路径', () => {
  const { lastFrame } = render(React.createElement(StatusBar, {
    model: 'GLM-5.2', mode: 'build', sessionId: 's1', status: 'idle'
  }));
  expect(lastFrame()).toContain('GLM-5.2');
  expect(lastFrame()).toContain('model:');
  expect(lastFrame()).toContain('idle');
});

test('StatusBar 显示 turn 号和 token', () => {
  const { lastFrame } = render(React.createElement(StatusBar, {
    model: 'GLM-5.2', mode: 'build', sessionId: 's1', status: 'running',
    turnNumber: 5, usage: { inputTokens: 15300 }
  }));
  const f = lastFrame();
  expect(f).toContain('turn: 5');
  expect(f).toContain('15k tok');
  expect(f).toContain('running');
});

test('StatusBar 格式化大 token 数', () => {
  const { lastFrame } = render(React.createElement(StatusBar, {
    model: 'M', mode: 'b', sessionId: 's', status: 'idle',
    usage: { inputTokens: 2300000 }
  }));
  expect(lastFrame()).toContain('2.3M tok');
});
