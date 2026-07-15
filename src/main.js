#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { ensureCliConfig } from './setup-cli-config.js';
import { ZCodeClient } from './zcode-client.js';
import { App } from './tui/App.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { resume: null, workspace: null };
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--resume' || args[i] === '-r') && args[i + 1]) {
      opts.resume = args[++i];
    } else if (args[i] === '--resume-last' || args[i] === '-R') {
      opts.resume = 'last';
    } else if (!args[i].startsWith('-')) {
      opts.workspace = args[i];
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs();

  // 1. 确保配置就绪
  try { ensureCliConfig(); }
  catch (e) {
    console.error(`配置错误: ${e.message}`);
    console.error('请先运行 ZCode GUI 登录一次,或手动配置 ~/.zcode/cli/config.json');
    process.exit(1);
  }

  // 2. 确定 workspace
  const workspace = opts.workspace || process.env.ZCODE_TUI_CWD || process.cwd();

  // 3. 连接 app-server
  const client = new ZCodeClient();
  try { await client.connect(); }
  catch (e) { console.error(`无法启动 app-server: ${e.message}`); process.exit(1); }

  // 4. 建会话（或恢复已有会话）
  let sessionId;
  try {
    if (opts.resume) {
      // 恢复模式
      let targetId = opts.resume;
      if (opts.resume === 'last') {
        // 列出会话，取最近一个
        const sessions = await client.listSessions();
        const list = Array.isArray(sessions) ? sessions : (sessions?.sessions || []);
        if (list.length > 0) {
          targetId = list[0].sessionId || list[0].id || list[0];
        } else {
          console.error('没有可恢复的会话，创建新会话');
          targetId = null;
        }
      }
      if (targetId) {
        sessionId = targetId;
        await client.resumeSession(sessionId);
        console.error(`已恢复会话: ${sessionId.slice(0, 12)}...`);
      } else {
        sessionId = await client.createSession(workspace);
      }
    } else {
      sessionId = await client.createSession(workspace);
    }
  }
  catch (e) { console.error(`会话操作失败: ${JSON.stringify(e)}`); await client.disconnect(); process.exit(1); }
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
