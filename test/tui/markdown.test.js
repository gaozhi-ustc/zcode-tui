import { test, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import chalk from 'chalk';
import { Markdown, StreamingMarkdown } from '../../src/tui/markdown/Markdown.js';
import { Ansi } from '../../src/tui/markdown/Ansi.js';
import { stringWidth } from '../../src/tui/markdown/string-width.js';

// Ansi 组件
test('Ansi 渲染纯文本', () => {
  const { lastFrame } = render(React.createElement(Ansi, null, 'hello world'));
  expect(lastFrame()).toContain('hello world');
});

test('Ansi 解析 chalk 产生的 ANSI 码', () => {
  const styled = chalk.bold.red('error');
  const { lastFrame } = render(React.createElement(Ansi, null, styled));
  expect(lastFrame()).toContain('error');
});

// stringWidth
test('stringWidth ASCII 宽度', () => {
  expect(stringWidth('hello')).toBe(5);
  expect(stringWidth('')).toBe(0);
});

test('stringWidth CJK 全角字符宽度2', () => {
  expect(stringWidth('你好')).toBe(4); // 每个汉字宽度2
  expect(stringWidth('a中')).toBe(3);  // a=1, 中=2
});

test('stringWidth ANSI 码不计宽度', () => {
  expect(stringWidth(chalk.red('hello'))).toBe(5);
});

// Markdown 渲染
test('Markdown 渲染纯文本', () => {
  const { lastFrame } = render(React.createElement(Markdown, null, 'just plain text'));
  expect(lastFrame()).toContain('just plain text');
});

test('Markdown 渲染标题', () => {
  const { lastFrame } = render(React.createElement(Markdown, null, '# Heading 1\n\n## Heading 2'));
  expect(lastFrame()).toContain('Heading 1');
  expect(lastFrame()).toContain('Heading 2');
});

test('Markdown 渲染列表', () => {
  const md = '- 第一项\n- 第二项\n- 第三项';
  const { lastFrame } = render(React.createElement(Markdown, null, md));
  expect(lastFrame()).toContain('第一项');
  expect(lastFrame()).toContain('第二项');
  expect(lastFrame()).toContain('第三项');
});

test('Markdown 渲染有序列表', () => {
  const md = '1. first\n2. second\n3. third';
  const { lastFrame } = render(React.createElement(Markdown, null, md));
  expect(lastFrame()).toContain('first');
  expect(lastFrame()).toContain('second');
});

test('Markdown 渲染行内代码', () => {
  const { lastFrame } = render(React.createElement(Markdown, null, 'use `npm test` to run'));
  expect(lastFrame()).toContain('npm test');
});

test('Markdown 渲染粗体和斜体', () => {
  const { lastFrame } = render(React.createElement(Markdown, null, 'this is **bold** and *italic*'));
  expect(lastFrame()).toContain('bold');
  expect(lastFrame()).toContain('italic');
});

test('Markdown 渲染引用块', () => {
  const { lastFrame } = render(React.createElement(Markdown, null, '> a quoted line'));
  expect(lastFrame()).toContain('a quoted line');
});

test('Markdown 渲染链接', () => {
  const { lastFrame } = render(React.createElement(Markdown, null, '[click](https://example.com)'));
  expect(lastFrame()).toContain('https://example.com');
});

test('Markdown 渲染代码块', () => {
  const md = '```js\nconsole.log("hi");\n```';
  const { lastFrame } = render(React.createElement(Markdown, null, md));
  expect(lastFrame()).toContain('console.log');
});

test('Markdown 渲染表格', () => {
  const md = '| 名称 | 值 |\n|---|---|\n| A | 1 |\n| B | 2 |';
  const { lastFrame } = render(React.createElement(Markdown, null, md));
  expect(lastFrame()).toContain('名称');
  expect(lastFrame()).toContain('A');
  expect(lastFrame()).toContain('B');
});

test('Markdown 渲染混合内容', () => {
  const md = '# Title\n\nSome **bold** text.\n\n- item 1\n- item 2\n\n```\ncode\n```';
  const { lastFrame } = render(React.createElement(Markdown, null, md));
  expect(lastFrame()).toContain('Title');
  expect(lastFrame()).toContain('item 1');
  expect(lastFrame()).toContain('code');
});

// StreamingMarkdown
test('StreamingMarkdown 渲染完整内容', () => {
  const { lastFrame } = render(React.createElement(StreamingMarkdown, null, 'hello world'));
  expect(lastFrame()).toContain('hello world');
});

test('StreamingMarkdown 增量追加保持内容', () => {
  const { lastFrame, rerender } = render(React.createElement(StreamingMarkdown, null, 'hello'));
  expect(lastFrame()).toContain('hello');
  // 模拟增量追加
  rerender(React.createElement(StreamingMarkdown, null, 'hello world'));
  expect(lastFrame()).toContain('hello world');
});
