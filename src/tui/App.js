import React, { useState, useRef } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { StatusBar } from './StatusBar.js';
import { MessageList } from './MessageList.js';
import { InputBox } from './InputBox.js';
import { ToolUse } from './components/ToolUse.js';
import { PermissionDialog } from './components/PermissionDialog.js';
import { QuestionDialog } from './components/QuestionDialog.js';
import { ModelPicker } from './components/ModelPicker.js';
import { PluginManager } from './components/PluginManager.js';
import { Spinner } from './components/Spinner.js';
import { useSessionEvents, buildRuleContent } from './useSessionEvents.js';

const DOUBLE_PRESS_TIMEOUT_MS = 800;

export function App({ client, sessionId, initialMessages = [], runtimeModel = null }) {
  const {
    messages, status, model, mode, turnNumber, usage,
    permissionQueue, questionQueue, autoModeEnabled, setAutoModeEnabled,
    turnStartTime, responseLength,
    isRunning, hasActiveTools, currentToolName,
    addUserMessage, addErrorMessage, clearMessages,
    toggleReasoning,
    setModel, decidePermission, respondQuestion, cancelQuestion,
  } = useSessionEvents(client, sessionId, initialMessages);

  const [scrollOffset, setScrollOffset] = useState(0);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
  const [plugins, setPlugins] = useState([]);
  const { exit } = useApp();

  const firstCtrlCRef = useRef(0);
  const runtimeModelRef = useRef(runtimeModel);
  const dialogActive = permissionQueue.length > 0 || questionQueue.length > 0;

  // Ctrl+C：running 时中断，idle 时双击退出
  // Ctrl+O：切换最后一条 assistant 消息的 reasoning 展开/折叠
  // ESC：running 时中断当前 turn
  useInput((input, key) => {
    // Ctrl+C
    if (input === '\x03') {
      const now = Date.now();
      if (isRunning) {
        if (typeof client.stop === 'function') client.stop(sessionId).catch(() => {});
        return;
      }
      if (now - firstCtrlCRef.current < DOUBLE_PRESS_TIMEOUT_MS) exit();
      else firstCtrlCRef.current = now;
      return;
    }
    // Ctrl+O：切换 reasoning 展开
    if (input === '\x0f') {
      toggleReasoning();
      return;
    }
    // ESC：running 时中断（对齐 Claude Code chat:cancel）
    if (key.escape && isRunning) {
      if (typeof client.stop === 'function') client.stop(sessionId).catch(() => {});
      return;
    }
  }, { isActive: !dialogActive });

  const handleSubmit = async (text) => {
    if (dialogActive) return;
    addUserMessage(text);
    setScrollOffset(0);
    if (text.startsWith('/')) {
      if (text.trim() === '/quit') exit();
      else await handleSlashCommand(text);
      return;
    }
    try {
      if (runtimeModelRef.current) {
        await client.sendMessage(sessionId, text, runtimeModelRef.current);
        runtimeModelRef.current = null;
      } else {
        await client.sendMessage(sessionId, text);
      }
    } catch (e) {
      const errMsg = e.message || JSON.stringify(e);
      if (errMsg.includes('模型') && errMsg.includes('不可用') || e.code === -32031) {
        addErrorMessage('模型不可用，请用 /model 选择模型');
        setModelPickerOpen(true);
      } else {
        addErrorMessage(errMsg);
      }
    }
  };

  // /help：显示可用命令和快捷键
  const showHelp = () => {
    const help = [
      '**可用命令:**',
      '  `/model [名称]`  切换或选择模型（无参数弹出选择面板）',
      '  `/mode <模式>`   切换权限模式（build/yolo/edit/plan/auto）',
      '  `/compact`       压缩对话上下文',
      '  `/clear`         清空当前对话',
      '  `/sessions`      列出可恢复的历史会话',
      '  `/help`          显示此帮助',
      '  `/quit`          退出',
      '',
      '**快捷键:**',
      '  `Ctrl+C`         中断当前任务 / 双击退出',
      '  `PageUp/Down`    翻看历史消息',
      '  `Shift+Enter`    多行输入换行',
      '  `↑/↓`            输入历史导航',
      '  `Tab`            接受 @ 文件补全',
    ].join('\n');
    setMessages(prev => [...prev, { role: 'assistant', text: help, streaming: false }]);
    setScrollOffset(0);
  };

  // /sessions：列出历史会话
  const showSessions = async () => {
    try {
      if (typeof client.listSessions !== 'function') return;
      const result = await client.listSessions();
      const sessions = result?.sessions || result || [];
      if (sessions.length === 0) {
        setMessages(prev => [...prev, { role: 'assistant', text: '没有历史会话。', streaming: false }]);
        return;
      }
      const lines = ['**历史会话（最近10个）:**', ...sessions.slice(0, 10).map((s, i) => {
        const title = s.title || '(无标题)';
        const sid = s.sessionId?.slice(0, 16) || 'unknown';
        const date = s.updatedAt ? new Date(s.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        const current = s.sessionId === sessionId ? ' ← 当前' : '';
        return `  ${i + 1}. ${title}  \`${sid}...\`  ${date}${current}`;
      }), '', '恢复命令: `zcode --resume <session-id>`'].join('\n');
      setMessages(prev => [...prev, { role: 'assistant', text: lines, streaming: false }]);
      setScrollOffset(0);
    } catch (e) {
      addErrorMessage(`/sessions: ${e.message}`);
    }
  };

  // /plugins：加载插件列表并打开管理面板
  const loadPlugins = async () => {
    try {
      const ws = { workspaceKey: process.cwd(), workspacePath: process.cwd() };
      const result = await client.send('plugins/list', { workspace: ws });
      setPlugins(result?.plugins || []);
      setPluginManagerOpen(true);
    } catch (e) {
      addErrorMessage(`/plugins: ${e.message}`);
    }
  };

  // 插件操作：enable/disable/uninstall
  const handlePluginAction = async (action, pluginId) => {
    try {
      const ws = { workspaceKey: process.cwd(), workspacePath: process.cwd() };
      if (action === 'enable' || action === 'disable') {
        await client.send('plugins/setEnabled', { workspace: ws, pluginId, enabled: action === 'enable' });
      } else if (action === 'uninstall') {
        await client.send('plugins/uninstall', { workspace: ws, pluginId });
      }
      // 刷新列表
      const result = await client.send('plugins/list', { workspace: ws });
      setPlugins(result?.plugins || []);
      addUserMessage(`插件 ${pluginId} 已${action === 'enable' ? '启用' : action === 'disable' ? '禁用' : '卸载'}`);
    } catch (e) {
      addErrorMessage(`插件操作失败: ${e.message}`);
    }
  };

  const handleSlashCommand = async (cmd) => {
    const parts = cmd.slice(1).split(/\s+/);
    const name = parts[0];
    const arg = parts.slice(1).join(' ');
    try {
      switch (name) {
        case 'model':
          if (arg) {
            const models = typeof client.getAvailableModels === 'function'
              ? await client.getAvailableModels() : [];
            const found = models.find(m => (m.ref?.modelId || m.label) === arg);
            await client.setModel(sessionId, found?.ref || { providerId: '', modelId: arg });
            setModel(arg);
          } else {
            const models = typeof client.getAvailableModels === 'function'
              ? await client.getAvailableModels() : [];
            setAvailableModels(models);
            setModelPickerOpen(true);
          }
          break;
        case 'mode':
          if (arg === 'auto') {
            // auto mode：前端 LLM 分类器自动批准权限
            setAutoModeEnabled(prev => {
              const next = !prev;
              addUserMessage(next
                ? '🤖 Auto mode 已开启：权限请求将由 LLM 自动判断（安全的自动批准，不安全的等待人工）'
                : 'Auto mode 已关闭');
              return next;
            });
          } else if (arg) {
            // 其他模式（build/yolo/edit/plan）透传给 server
            setAutoModeEnabled(false);
            await client.setMode(sessionId, arg);
          }
          break;
        case 'compact':
          if (typeof client.compact === 'function') await client.compact(sessionId);
          break;
        case 'clear':
          clearMessages();
          break;
        case 'help':
        case '?':
          showHelp();
          break;
        case 'sessions':
          await showSessions();
          break;
        case 'think':
        case 'thought':
          if (typeof client.send === 'function') {
            const level = arg || 'medium';
            await client.send('session/setThoughtLevel', { sessionId, thoughtLevel: level });
            addUserMessage(`思考深度已设置为: ${level}`);
          }
          break;
        case 'plugins':
        case 'plugin':
          await loadPlugins();
          break;
      }
    } catch (e) {
      addErrorMessage(`/${name}: ${e.message}`);
    }
  };

  // 权限决策
  const handlePermissionDecide = (decision) => {
    const result = decidePermission(decision);
    if (!result) return;
    try {
      if (decision === 'yes-always') {
        client.respondToServer(result.rpcId, {
          decision: 'allow',
          permissionUpdates: [{ type: 'addRules', behavior: 'allow',
            rules: [{ toolName: result.toolName, ...buildRuleContent(result.input) }] }],
        });
      } else {
        client.respondToServer(result.rpcId, { decision: decision === 'yes' ? 'allow' : 'deny' });
      }
    } catch (e) { addErrorMessage(`权限响应失败: ${e.message}`); }
  };

  // 提问响应
  const handleQuestionRespond = (answers) => {
    const result = respondQuestion(answers);
    if (!result) return;
    // 回显选择
    const lines = Object.entries(answers || {}).map(([q, a]) => {
      const labels = Array.isArray(a) ? a : [a];
      return `${q.slice(0, 57)}: ${labels.join(', ')}`;
    });
    if (lines.length) { addUserMessage(lines.join('\n')); setScrollOffset(0); }
    try {
      const normalized = {};
      for (const [k, v] of Object.entries(answers || {})) normalized[k] = Array.isArray(v) ? v : [v];
      // result schema (Dq): { action: "accept"|"decline"|"cancel", content?, reason? }
      client.respondToServer(result.rpcId, { action: 'accept', content: { answers: normalized } });
    } catch (e) { addErrorMessage(`提问响应失败: ${e.message}`); }
  };

  const handleQuestionCancel = () => {
    const result = cancelQuestion();
    if (!result) return;
    try { client.respondToServer(result.rpcId, { action: 'cancel', reason: 'user cancelled' }); }
    catch (e) { addErrorMessage(`提问取消失败: ${e.message}`); }
  };

  // 根高度锁定视口行数：保证渲染输出永不超视口，从源头杜绝
  // ink 溢出帧的整屏全清回退（tmux 下击键闪烁的根因，见 S8c）
  const { stdout } = useStdout();
  const termRows = stdout?.rows || 24;

  return React.createElement(Box, { flexDirection: 'column', height: termRows, overflow: 'hidden' },
    React.createElement(StatusBar, { model, mode: autoModeEnabled ? '🤖 auto' : mode, sessionId, status, turnNumber, usage }),
    React.createElement(Box, { flexGrow: 1, flexDirection: 'column', overflow: 'hidden' },
      React.createElement(MessageList, { messages, scrollOffset, setScrollOffset, inputDisabled: dialogActive || modelPickerOpen }),
    ),
    React.createElement(Spinner, {
      active: isRunning && !dialogActive && !modelPickerOpen,
      startTime: turnStartTime, responseLength, usage,
      currentToolName, hasActiveTools,
    }),
    // 交互层：PluginManager > ModelPicker > QuestionDialog > PermissionDialog > InputBox
    pluginManagerOpen
      ? React.createElement(PluginManager, {
          plugins,
          onAction: handlePluginAction,
          onClose: () => setPluginManagerOpen(false),
        })
      : modelPickerOpen
      ? React.createElement(ModelPicker, {
          models: availableModels, currentModel: model,
          onSelect: async (m) => {
            try {
              const ref = m.ref || { providerId: '', modelId: m.label };
              await client.setModel(sessionId, ref);
              setModel(m.ref?.modelId || m.label);
            } catch (e) { addErrorMessage(`切换模型失败: ${e.message}`); }
            setModelPickerOpen(false);
          },
          onCancel: () => setModelPickerOpen(false),
        })
      : questionQueue.length > 0
        ? React.createElement(QuestionDialog, {
            questions: questionQueue[0].questions || [],
            onRespond: handleQuestionRespond, onCancel: handleQuestionCancel,
          })
        : permissionQueue.length > 0
          ? React.createElement(PermissionDialog, {
              toolName: permissionQueue[0].toolName || 'unknown',
              detail: permissionQueue[0].detail,
              queueIndex: 1, queueTotal: permissionQueue.length,
              onDecide: handlePermissionDecide,
            })
          : React.createElement(InputBox, { onSubmit: handleSubmit }),
    React.createElement(Text, { dimColor: true }, isRunning
      ? '[Ctrl+C] 中断当前任务'
      : questionQueue.length > 0
        ? (questionQueue.length > 1
            ? `[↑↓] 选择  [Enter] 确认  [Esc] 取消  (第 1/${questionQueue.length} 个提问)`
            : '[↑↓] 选择  [Enter] 确认  [Esc] 取消')
        : permissionQueue.length > 0
          ? (permissionQueue.length > 1
              ? `[y] 允许  [a] 本工具总允许  [n] 拒绝  (第 1/${permissionQueue.length} 个权限请求)`
              : '[y] 允许  [a] 本工具总允许  [n] 拒绝')
          : isRunning
            ? '[Esc/Ctrl+C] 中断  [Ctrl+O] 思考过程  [/quit] quit'
            : '[Ctrl+C×2] quit  [/quit] quit  [/clear] 清屏  [/help] 帮助')
  );
}
