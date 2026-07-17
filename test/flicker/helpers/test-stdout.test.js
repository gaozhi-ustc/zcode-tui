import React from 'react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Text } from 'ink';
import { renderInk, flushFrames, TestStdout } from './test-stdout.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('TestStdout 记录 frames 且尺寸可配', () => {
  const stdout = new TestStdout({ columns: 80, rows: 20 });
  expect(stdout.columns).toBe(80);
  expect(stdout.rows).toBe(20);
  stdout.write('abc');
  expect(stdout.frames).toEqual(['abc']);
});

test('TestStdout 把 BSU..ESU 同步更新块合并为一个逻辑帧', () => {
  const stdout = new TestStdout({ columns: 80, rows: 20 });
  stdout.write('\x1b[?2026h');
  stdout.write('\x1b[2K\x1b[1A内容');
  stdout.write('\x1b[?2026l');
  expect(stdout.frames).toEqual(['\x1b[?2026h\x1b[2K\x1b[1A内容\x1b[?2026l']);
  // 块外 write 仍各自成帧
  stdout.write('abc');
  expect(stdout.frames).toHaveLength(2);
});

test('renderInk 以交互模式渲染并保留擦除序列', async () => {
  const app = renderInk(React.createElement(Text, null, '第一行'), { columns: 80, rows: 20 });
  await flushFrames(100);
  expect(app.frames.length).toBeGreaterThan(0);
  expect(app.frames.join('')).toContain('第一行');
  app.unmount();
});

test('resize 发射 resize 事件且 ink 跟随重渲染', async () => {
  const app = renderInk(React.createElement(Text, null, 'resize-marker'), { columns: 80, rows: 20 });
  await flushFrames(100);
  app.stdout.frames.length = 0;
  app.stdout.resize(60, 20);
  await flushFrames(100);
  expect(app.frames.join('')).toContain('resize-marker');
  app.unmount();
});
