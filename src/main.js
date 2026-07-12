#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { ensureCliConfig } from './setup-cli-config.js';
import { ZCodeClient } from './zcode-client.js';
import { App } from './tui/App.js';

async function main() {
  // 1. 确保配置就绪
  try { ensureCliConfig(); }
  catch (e) {
    console.error(`配置错误: ${e.message}`);
    console.error('请先运行 ZCode GUI 登录一次,或手动配置 ~/.zcode/cli/config.json');
    process.exit(1);
  }

  // 2. 确定 workspace
  const workspace = process.env.ZCODE_TUI_CWD || process.cwd();

  // 3. 连接 app-server
  const client = new ZCodeClient();
  try { await client.connect(); }
  catch (e) { console.error(`无法启动 app-server: ${e.message}`); process.exit(1); }

  // 4. 建会话
  let sessionId;
  try { sessionId = await client.createSession(workspace); }
  catch (e) { console.error(`创建会话失败: ${JSON.stringify(e)}`); await client.disconnect(); process.exit(1); }
  await client.subscribe(sessionId);

  // 5. 渲染 TUI
  const instance = render(React.createElement(App, { client, sessionId }));

  // 6. 退出清理
  const cleanup = async () => { instance.unmount(); await client.disconnect(); process.exit(0); };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  client.on('exit', () => { console.error('app-server 意外退出'); process.exit(1); });
}

main();
