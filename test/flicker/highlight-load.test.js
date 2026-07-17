import React from 'react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';

// mock cli-highlight：highlight 产物带可识别 ANSI 标记
vi.mock('cli-highlight', () => ({
  default: { highlight: (code) => `\x1b[32m${code}\x1b[39m`, supportsLanguage: () => true },
  highlight: (code) => `\x1b[32m${code}\x1b[39m`,
  supportsLanguage: () => true,
}));

const { renderInk, flushFrames } = await import('./helpers/test-stdout.js');
const { measureFrames } = await import('./helpers/frame-metrics.js');
const { checkBaseline } = await import('./helpers/baseline.js');
const { Markdown } = await import('../../src/tui/markdown/Markdown.js');

// 测试环境 chalk 检测不到 TTY（level 0），ink 渲染 <Text color> 时颜色被 chalk 剥掉：
// 高亮前后输出字节完全相同 → ink 判定无变化不写帧，且 \x1b[32m 标记不可能出现。
// 强制 level 1 让 SGR 真实落到帧里（vitest 每个测试文件独立 module registry，不影响其他文件）。
const chalk = (await import('chalk')).default;
chalk.level = 1;

const CODE_MD = '说明文字\n\n```js\nconst HL_MARKER = 1;\n```\n';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('S5: highlight 加载完成后代码块着色，全局重渲染次数入基线', async () => {
  const app = renderInk(React.createElement(Markdown, null, CODE_MD));
  // 初始（未高亮）帧丢弃：mock 的 import 在首个 flush 的微任务内即完成并触发重渲染，
  // 必须在 flush 前清帧，度量窗口才能只含 highlight 加载触发的全局重渲染。
  app.stdout.frames.length = 0;

  await flushFrames(50);
  // 等异步 import('cli-highlight') 完成并触发重渲染
  await vi.advanceTimersByTimeAsync(0);
  await flushFrames(100);

  const after = app.frames.join('');
  expect(after).toContain('HL_MARKER');
  expect(after).toContain('\x1b[32m'); // 高亮已生效（终态正确）
  const m = measureFrames(app.stdout.frames);
  checkBaseline('s5-highlight-load', m); // 全局重渲染帧数入基线（闪变度量）
  app.unmount();
});
