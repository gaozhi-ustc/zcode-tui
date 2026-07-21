import React from 'react';
import { test, expect, vi, afterEach } from 'vitest';
import { formatDuration, formatTokens } from '../../src/tui/components/Spinner.js';
import { renderInk } from '../flicker/helpers/test-stdout.js';
import { Spinner } from '../../src/tui/components/Spinner.js';

afterEach(() => { vi.useRealTimers(); });

test('等待时耗时 2 秒后即显示（秒级），token 30 秒后显示', async () => {
  vi.useFakeTimers();
  const app = renderInk(React.createElement(Spinner, {
    active: true, startTime: Date.now(), responseLength: 0, hasActiveTools: false,
  }));
  await vi.advanceTimersByTimeAsync(3000);
  let out = app.frames.join('');
  expect(out).toMatch(/\([1-9]\d*s\)/);      // (3s) 已显示，秒级精度
  expect(out).not.toContain('tokens');      // token 仍未显示
  await vi.advanceTimersByTimeAsync(28000); // → 31s
  out = app.frames.join('');
  expect(out).toContain('31s');
  expect(out).toContain('tokens');          // 30s 后 token 显示
  app.unmount();
});

// === formatDuration（对齐 Claude Code）===

test('formatDuration < 1s 返回 0s', () => {
  expect(formatDuration(0)).toBe('0s');
  expect(formatDuration(500)).toBe('0s');
  expect(formatDuration(999)).toBe('0s');
});

test('formatDuration < 60s 返回整数秒', () => {
  expect(formatDuration(1000)).toBe('1s');
  expect(formatDuration(12000)).toBe('12s');
  expect(formatDuration(59999)).toBe('59s');
});

test('formatDuration 1m-1h 返回 Xm Ys', () => {
  expect(formatDuration(60000)).toBe('1m 0s');
  expect(formatDuration(135000)).toBe('2m 15s');
  expect(formatDuration(3599999)).toBe('59m 59s');
});

test('formatDuration > 1h 返回 Xh Ym', () => {
  expect(formatDuration(3600000)).toBe('1h 0m');
  expect(formatDuration(3900000)).toBe('1h 5m');
});

// === formatTokens（对齐 Claude Code formatNumber compact）===

test('formatTokens 小数直接显示', () => {
  expect(formatTokens(0)).toBe('0');
  expect(formatTokens(100)).toBe('100');
  expect(formatTokens(999)).toBe('999');
});

test('formatTokens 千位用 k', () => {
  expect(formatTokens(1000)).toBe('1.0k');
  expect(formatTokens(1321)).toBe('1.3k');
  expect(formatTokens(3200)).toBe('3.2k');
});

test('formatTokens 百万用 m', () => {
  expect(formatTokens(1000000)).toBe('1.0m');
  expect(formatTokens(2300000)).toBe('2.3m');
});
