import React, { useState, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { StatusBar } from './StatusBar.js';
import { MessageList } from './MessageList.js';
import { InputBox } from './InputBox.js';
import { ToolUse } from './components/ToolUse.js';
import { PermissionDialog } from './components/PermissionDialog.js';
import { QuestionDialog } from './components/QuestionDialog.js';
import { ModelPicker } from './components/ModelPicker.js';
import { Spinner } from './components/Spinner.js';
import { useSessionEvents, buildRuleContent } from './useSessionEvents.js';

const DOUBLE_PRESS_TIMEOUT_MS = 800;

export function App({ client, sessionId, initialMessages = [], runtimeModel = null }) {
  const {
    messages, status, model, mode, turnNumber, usage,
    permissionQueue, questionQueue, turnStartTime, responseLength,
    isRunning, hasActiveTools, currentToolName,
    addUserMessage, addErrorMessage, clearMessages,
    setModel, decidePermission, respondQuestion, cancelQuestion,
  } = useSessionEvents(client, sessionId, initialMessages);

  const [scrollOffset, setScrollOffset] = useState(0);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const { exit } = useApp();

  const firstCtrlCRef = useRef(0);
  const runtimeModelRef = useRef(runtimeModel);
  const dialogActive = permissionQueue.length > 0 || questionQueue.length > 0;

  // Ctrl+C：running 时中断，idle 时双击退出
  useInput((input, key) => {
    if (input !== '\x03') return;
    const now = Date.now();
    if (isRunning) {
      if (typeof client.stop === 'function') client.stop(sessionId).catch(() => {});
      setStatusIdle();
      return;
    }
    if (now - firstCtrlCRef.current < DOUBLE_PRESS_TIMEOUT_MS) exit();
    else firstCtrlCRef.current = now;
  }, { isActive: !dialogActive });

  function setStatusIdle() {
    // 委托给 hook 的 setStatus —— 但 hook 没暴露，用 stop 的副作用
  }

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
          if (arg) { await client.setMode(sessionId, arg); }
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
      client.respondToServer(result.rpcId, { answers: normalized });
    } catch (e) { addErrorMessage(`提问响应失败: ${e.message}`); }
  };

  const handleQuestionCancel = () => {
    const result = cancelQuestion();
    if (!result) return;
    try { client.respondToServer(result.rpcId, { canceled: true }); }
    catch (e) { addErrorMessage(`提问取消失败: ${e.message}`); }
  };

  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(StatusBar, { model, mode, sessionId, status, turnNumber, usage }),
    React.createElement(Box, { flexGrow: 1, flexDirection: 'column', overflow: 'hidden' },
      React.createElement(MessageList, { messages, scrollOffset, setScrollOffset, inputDisabled: dialogActive || modelPickerOpen }),
    ),
    React.createElement(Spinner, {
      active: isRunning && !dialogActive && !modelPickerOpen,
      startTime: turnStartTime, responseLength, usage,
      currentToolName, hasActiveTools,
    }),
    // 交互层：ModelPicker > QuestionDialog > PermissionDialog > InputBox
    modelPickerOpen
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
          : '[Ctrl+C×2] quit  [/quit] quit  [/clear] 清屏')
  );
}
