#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { ensureCliConfig } from './setup-cli-config.js';
import { ZCodeClient } from './zcode-client.js';
import { App } from './tui/App.js';
import { buildRuntimeModel } from './build-runtime-model.js';

/**
 * 把 app-server session/read 返回的历史消息转成 App 可渲染的格式。
 * 原始格式：{info:{agent,...}, parts:[{type:'text'|'tool'|..., ...}]}
 * 转成：{role:'user'|'assistant'|'tool', text|toolName|...}
 */
function convertHistoryMessages(rawMessages) {
  const result = [];
  for (const msg of rawMessages) {
    const isUser = msg.info?.agent === 'user' || msg.info?.role === 'user';
    const parts = msg.parts || [];
    // 收集 assistant 文本和工具调用
    const textParts = parts.filter(p => p.type === 'text');
    const toolParts = parts.filter(p => p.type === 'tool');

    if (isUser && textParts.length > 0) {
      result.push({ role: 'user', text: textParts.map(p => p.text).join('\n') });
    } else if (!isUser) {
      // assistant 文本
      if (textParts.length > 0) {
        result.push({
          role: 'assistant',
          text: textParts.map(p => p.text).join('\n'),
          streaming: false,
        });
      }
      // 工具调用
      for (const tp of toolParts) {
        if (tp.state === 'result' || tp.result) {
          result.push({
            role: 'tool',
            toolName: tp.tool || tp.name || 'unknown',
            toolInput: tp.input || {},
            toolCallId: tp.callId,
            result: tp.result,
            error: tp.result?.success === false,
            streaming: false,
          });
        } else {
          result.push({
            role: 'tool',
            toolName: tp.tool || tp.name || 'unknown',
            toolInput: tp.input || {},
            toolCallId: tp.callId,
            result: null,
            streaming: false,
          });
        }
      }
    }
  }
  return result;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { resume: null, workspace: null };
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--resume' || args[i] === '-r') && args[i + 1]) {
      opts.resume = args[++i];
    } else if (args[i] === '--resume-last' || args[i] === '-R' || args[i] === 'resume') {
      // 'resume' 作为裸子命令也支持（git 风格：zcode resume）
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
  let historyMessages = [];
  try {
    if (opts.resume) {
      let targetId = opts.resume;
      let targetTitle = '';
      if (opts.resume === 'last') {
        // 列出会话，取最近一个非当前的
        const result = await client.listSessions();
        const list = result?.sessions || result || [];
        if (list.length > 0) {
          const target = list[0];
          targetId = target.sessionId || target.id;
          targetTitle = target.title || '';
        } else {
          console.error('没有可恢复的会话，创建新会话');
          targetId = null;
        }
      }
      if (targetId) {
        sessionId = targetId;
        await client.resumeSession(sessionId);
        // 拉取历史消息
        const read = await client.send('session/read', { sessionId });
        historyMessages = convertHistoryMessages(read.messages || []);
        // 检查模型可用性：旧会话的模型可能已不可用
        try {
          const models = await client.getAvailableModels(workspace);
          if (models.length > 0) {
            // 切换到第一个可用模型（避免旧模型不可用）
            const firstModel = models[0];
            const modelId = firstModel.ref?.modelId || firstModel.label;
            await client.setModel(sessionId, firstModel.ref || { providerId: '', modelId });
            // 触发 deferred model adapter 初始化（resume 后模型不可用时的修复）
            try {
              await client.send('session/updateRuntimeModelConfig', {
                sessionId,
                runtimeModel: firstModel.ref || { providerId: '', modelId },
                applyModelSelection: true,
              });
            } catch {}
            console.error(`已恢复会话${targetTitle ? `「${targetTitle}」` : ''}: ${sessionId.slice(0, 12)}... (${historyMessages.length} 条历史, 模型: ${modelId})`);
          } else {
            console.error(`已恢复会话${targetTitle ? `「${targetTitle}」` : ''}: ${sessionId.slice(0, 12)}... (${historyMessages.length} 条历史消息)`);
          }
        } catch (modelErr) {
          console.error(`已恢复会话${targetTitle ? `「${targetTitle}」` : ''}: ${sessionId.slice(0, 12)}... (${historyMessages.length} 条历史消息)`);
          console.error(`模型切换失败: ${JSON.stringify(modelErr.message || modelErr)}`);
          console.error('提示: 进入后用 /model 切换可用模型');
        }
      } else {
        sessionId = await client.createSession(workspace);
      }
    } else {
      sessionId = await client.createSession(workspace);
    }
  }
  catch (e) { console.error(`会话操作失败: ${JSON.stringify(e)}`); await client.disconnect(); process.exit(1); }
  await client.subscribe(sessionId);

  // 5. 为 resume 的会话构造 runtimeModel（清除 restoreWarning 用）
  let runtimeModel = null;
  if (opts.resume) {
    runtimeModel = await buildRuntimeModel(client, workspace);
  }

  // 6. 渲染 TUI
  const instance = render(React.createElement(App, { client, sessionId, initialMessages: historyMessages, runtimeModel }));

  // 6. 退出清理
  let exiting = false;
  const cleanup = async () => {
    if (exiting) return;
    exiting = true;
    try { instance.unmount(); } catch {}
    try { await client.disconnect(); } catch {}
    console.error(`\n会话已保存: ${sessionId}`);
    console.error(`恢复命令: zcode --resume ${sessionId}`);
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // app-server 崩溃：不直接 exit，显示错误 + 恢复命令
  client.on('exit', (code) => {
    if (exiting) return;
    exiting = true;
    try { instance.unmount(); } catch {}
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error(`⚠️  app-server 意外退出 (code: ${code})`);
    console.error(`会话已保存: ${sessionId}`);
    console.error(`恢复命令: zcode --resume ${sessionId}`);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    process.exit(1);
  });
}

main();
