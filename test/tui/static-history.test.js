import React from 'react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderInk, flushFrames } from '../flicker/helpers/test-stdout.js';
import { makeMockClient, makeScript } from '../flicker/helpers/event-source.js';
import { App } from '../../src/tui/App.js';

/**
 * <Static> 历史区（滚动进终端缓冲区）回归测试。
 * 目标架构：已完成消息（finalized 前缀）渲染进 ink 的 Static 区，
 * 打印一次后进入 scrollback，永不重绘；动态区只留在飞内容。
 */

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('超出视口的历史消息也被写入输出（进入 scrollback）', async () => {
  const client = makeMockClient();
  // 50 条已完成消息，视口仅 20 行：旧架构按行预算只渲染尾部，
  // 最早的消息从不出现在任何输出中；Static 架构全部写入（滚进缓冲区）
  const history = Array.from({ length: 50 }, (_, i) => ({
    role: 'user', text: `历史消息-${i}`, streaming: false,
  }));
  const app = renderInk(React.createElement(App, {
    client, sessionId: 'sess_test', initialMessages: history,
  }), { columns: 100, rows: 20 });
  await flushFrames(200);

  const out = app.stdout.frames.join('');
  expect(out).toContain('历史消息-0');  // 最早的消息也被写入（scrollback）
  expect(out).toContain('历史消息-49'); // 最新的当然也在
  app.unmount();
});

test('历史消息不再随 spinner tick 重绘（Static 只打印一次）', async () => {
  const client = makeMockClient();
  const app = renderInk(React.createElement(App, {
    client, sessionId: 'sess_test',
    initialMessages: [
      { role: 'user', text: '历史问题MARKER' },
      { role: 'assistant', text: '历史回答MARKER', streaming: false },
    ],
  }));
  await flushFrames(100);
  app.stdout.frames.length = 0; // 只观察之后的帧

  await makeScript(client).turnStart(1).run();
  await vi.advanceTimersByTimeAsync(2000); // spinner 多次 tick

  const out = app.stdout.frames.join('');
  // Static 架构下历史不进入任何后续帧；旧架构每帧全量重写必含历史
  expect(out).not.toContain('历史问题MARKER');
  expect(out).not.toContain('历史回答MARKER');
  app.unmount();
});

test('turn 完成后消息进入 Static 且不重复', async () => {
  const client = makeMockClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await flushFrames(100);

  await makeScript(client).turnStart(1).run();
  await flushFrames(50);
  await makeScript(client).textDelta('最终答案FINAL', { mid: 'm1' }).run();
  await flushFrames(50);
  await makeScript(client).turnComplete(1).run();
  await flushFrames(200);

  // 完成后的消息被打印输出（进入 Static），且不再滞留在动态区
  expect(app.stdout.frames.join('')).toContain('最终答案FINAL');
  const last = app.stdout.frames.at(-1);
  expect(last).not.toContain('最终答案FINAL');
  app.unmount();
});

test('文本流式中工具完成：finalized 前缀顺序安全', async () => {
  const client = makeMockClient();
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }));
  await flushFrames(100);

  // a1 文本仍在流式时，t1 工具已完成：t1 不得先于 a1 进入 Static
  await makeScript(client).turnStart(1).run();
  await flushFrames(50);
  await makeScript(client)
    .textDelta('流式中STREAM', { mid: 'm1' })
    .toolCall('Bash', { command: 'ls' }, 't1')
    .toolResult('t1', { success: true, content: '工具结果TOOLRES' })
    .run();
  await flushFrames(100);
  // 前缀停留在 a1 之前（a1 仍 streaming）：t1 在动态区渲染，Static 不插序
  const last = app.stdout.frames.at(-1);
  expect(last).toContain('工具结果TOOLRES');
  expect(last).toContain('流式中STREAM');
  app.unmount();
});
