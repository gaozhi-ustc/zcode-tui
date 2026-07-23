import React from 'react';
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderInk, flushFrames } from './helpers/test-stdout.js';
import { visibleLines } from './helpers/frame-metrics.js';
import { makeMockClient, makeScript } from './helpers/event-source.js';
import { App } from '../../src/tui/App.js';

/**
 * S9: 表格 + 后续段落流式渲染 —— 底边框不得被后续文字覆盖（现场 bug）。
 * 现场：表格底边框行被其后段落文字覆盖，残留右半段边框。
 */

const TABLE_MD = [
  '介绍如下：',
  '',
  '| 步骤 | 内容 | 说明 |',
  '| --- | --- | --- |',
  '| 安装 | curl 一键脚本 | 无需 root |',
  '| 引擎 | 查找 zcode.cjs | 无 GUI 也能装 |',
  '',
  '详细手册在 docs/install-guide.md（含 root 系统级安装、迁移、故障排查、卸载）。',
].join('\n');

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('S9: 流式表格+段落，所有帧底边框完整、无文字覆盖', async () => {
  const client = makeMockClient();
  // 131 列（对齐现场）+ 宽 CJK 表格 + 长内容
  const app = renderInk(React.createElement(App, { client, sessionId: 'sess_test' }), { columns: 131, rows: 36 });
  await flushFrames(100);

  const wideTable = [
    '一键安装脚本已完成，文件：install.sh（项目根目录）。安装方式：',
    '',
    'curl -fsSL https://raw.githubusercontent.com/gaozhi-ustc/zcode-tui/master/install.sh | bash',
    '',
    '| 步骤 | 内容 | 说明 |',
    '| --- | --- | --- |',
    '| **1. Node.js** | 检查 22+，不够则用 nvm 自动安装 24 | 无需 root |',
    '| **2. 代码** | clone `zcode-tui` 到 `~/zcode-tui` + `npm install` | 已存在则 `git pull` |',
    '| **3. 引擎** | 查找 `zcode.cjs`（9MB），优先级：`/opt/ZCode` → `~/.local/share/zcode` → 用户输入路径/URL | 无 GUI 也能装 |',
    '| **4. wrapper** | 复制 `zcode-wrapper.sh` 到 `~/.local/bin/zcode`，加 PATH | 自适应路径 + login/config 子命令 |',
    '| **5. 认证** | 三选一：①`zcode login`（device-code 浏览器登录）②API Key ③跳过 | 检测到已有配置则跳过 |',
    '| **6. 验证** | 检查引擎/配置/命令/PATH 四项是否就绪 | 逐项 ✓/⚠ |',
    '',
    '详细手册在 docs/install-guide.md（含 root 系统级安装、迁移、故障排查、卸载）。',
  ].join('\n');

  // 细粒度流式（30 字符一块），迫使表格跨多个 delta 逐步形成
  const script = makeScript(client).turnStart(1);
  for (let i = 0; i < wideTable.length; i += 30) {
    script.textDelta(wideTable.slice(i, i + 30), { mid: 'm1' });
  }
  await script.turnComplete(1).run();
  await flushFrames(300);

  // 所有帧都不得出现“段落文字与边框字符同行混杂”（覆盖/快照发散）
  app.stdout.frames.forEach((f, i) => {
    const mixed = visibleLines(f).filter(l => l.includes('详细手册') && /[└┴┘┌┬┐│]/.test(l));
    expect(mixed, `帧#${i} 段落与边框混杂: ${JSON.stringify(mixed)}`).toEqual([]);
  });

  const lines = visibleLines(app.stdout.frames.at(-1));
  const bottomBorder = lines.find(l => l.trim().startsWith('└'));
  expect(bottomBorder, `末帧缺少完整底边框:\n${lines.join('\n')}`).toBeTruthy();
  app.unmount();
});
