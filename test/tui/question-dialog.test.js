import React from 'react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import chalk from 'chalk';

// 本文件需要验证 ANSI 反色序列：强制 chalk 开色（模块注册表按文件隔离，不影响其他测试）
chalk.level = 1;

const { renderInk, flushFrames } = await import('../flicker/helpers/test-stdout.js');
const { QuestionDialog } = await import('../../src/tui/components/QuestionDialog.js');

const QUESTIONS = [{
  question: '选哪个方案?',
  options: [
    { label: 'Approve', description: '方案 A 的描述' },
    { label: 'Reject', description: '方案 B 的描述' },
  ],
}];

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('选中项使用反色高亮（背景色），与未选中项视觉可区分', async () => {
  const app = renderInk(React.createElement(QuestionDialog, {
    questions: QUESTIONS, onRespond: () => {}, onCancel: () => {},
  }));
  await flushFrames(100);
  const out = app.stdout.frames.join('');
  expect(out).toContain('Approve');
  // 选中项标签必须有反白/背景色序列（chalk.bgCyan = ESC[46m 或通用反色 ESC[7m）
  expect(out).toMatch(/\x1b\[(46|7)m/);
  app.unmount();
});

test('回答提交 option.value 而非 label（server 以 value 判定 plan 审批）', async () => {
  // server 的 plan 审批选项 {label:'Approve', value:'approve'}，
  // 期望值恰好是 'approve'；回 label 'Approve' 会被判 deny（现场 plan mode 卡死）
  let submitted = null;
  const planQ = [{
    header: 'Plan',
    question: 'Review this implementation plan.',
    options: [{ label: 'Approve', value: 'approve', description: 'Exit plan mode and start implementation.' }],
  }];
  const app = renderInk(React.createElement(QuestionDialog, {
    questions: planQ, onRespond: (a) => { submitted = a; }, onCancel: () => {},
  }));
  await flushFrames(100);
  app.stdin.write('\r');
  await flushFrames(100);
  expect(submitted?.['Review this implementation plan.']).toBe('approve');
  app.unmount();
});

test('选项 label 缺失时兜底显示 name/value/string，不留空白行', async () => {
  const weird = [{
    question: '兜底?',
    options: [
      { name: 'ApproveByName', description: 'name 字段' },
      { value: 'reject', description: 'value 字段' },
      'PlainString',
    ],
  }];
  const app = renderInk(React.createElement(QuestionDialog, {
    questions: weird, onRespond: () => {}, onCancel: () => {},
  }));
  await flushFrames(100);
  const out = app.stdout.frames.join('');
  expect(out).toContain('ApproveByName');
  expect(out).toContain('reject');
  expect(out).toContain('PlainString');
  app.unmount();
});
