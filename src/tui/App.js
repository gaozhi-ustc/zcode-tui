import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { StatusBar } from './StatusBar.js';
import { MessageList } from './MessageList.js';
import { InputBox } from './InputBox.js';
import { ToolUse } from './components/ToolUse.js';
import { PermissionDialog } from './components/PermissionDialog.js';
import { QuestionDialog } from './components/QuestionDialog.js';
import { parseEvent } from '../zcode-client.js';

// Normalize whatever the client emits on 'event' into a parsed event object.
function normalizeEvent(raw) {
  if (raw && typeof raw === 'object' && typeof raw.method === 'string') {
    return parseEvent(raw);
  }
  return raw;
}

/**
 * 根据工具类型和输入，提取权限请求的具体操作描述。
 * 让用户清楚知道要授权的是什么操作（命令内容、文件路径、搜索内容等）。
 */
function formatPermissionDetail(params) {
  const { toolName, input, reason, riskLevel } = params;
  const parts = [];

  // 风险等级
  if (riskLevel) {
    const riskLabel = { high: '⚠️ 高风险', medium: '🔶 中风险', low: '🟢 低风险' }[riskLevel] || riskLevel;
    parts.push(riskLabel);
  }

  // 按工具类型提取具体操作
  if (input && typeof input === 'object') {
    const detail = extractToolAction(toolName, input);
    if (detail) parts.push(detail);
  }

  // server 给的原因（通常是一句话说明为什么需要权限）
  if (reason) parts.push(reason);

  return parts.join('\n');
}

/** 按工具类型提取具体的操作内容。 */
function extractToolAction(toolName, input) {
  const cmd = input.command || input.cmd;
  const filePath = input.file_path || input.filePath || input.path;
  const pattern = input.pattern || input.query || input.prompt || input.searchText;

  if (cmd) return `$ ${cmd}`;
  if (filePath && input.old_string != null) return `编辑文件: ${filePath}`;
  if (filePath && input.content != null) return `写入文件: ${filePath}`;
  if (filePath) return `访问文件: ${filePath}`;
  if (pattern) return `${toolName}: ${truncate(pattern, 100)}`;
  if (input.url) return `访问: ${input.url}`;
  // 兜底：展示 JSON 摘要
  const keys = Object.keys(input);
  if (keys.length > 0) {
    return `${toolName}: ${keys.map(k => `${k}=${truncate(String(input[k]), 40)}`).join(', ')}`;
  }
  return toolName || '';
}

function truncate(s, max) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

const DOUBLE_PRESS_TIMEOUT_MS = 800;

export function App({ client, sessionId }) {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('idle');
  const [model, setModel] = useState('GLM-5.2');
  const [mode, setMode] = useState('build');
  const [scrollOffset, setScrollOffset] = useState(0);
  const [turnNumber, setTurnNumber] = useState(0);
  const [usage, setUsage] = useState(null);
  // 权限请求队列
  const [permissionQueue, setPermissionQueue] = useState([]);
  // 用户提问请求队列（对齐 AskUserQuestion：问题文本 + 选项列表）
  const [questionQueue, setQuestionQueue] = useState([]);
  const { exit } = useApp();

  const isRunning = status === 'running';
  const firstCtrlCRef = useRef(0);
  const lastProgressRef = useRef(0);

  useEffect(() => {
    const onEvent = (raw) => {
      const evt = normalizeEvent(raw);
      if (!evt || typeof evt !== 'object') return;
      if (evt.type === 'state') {
        if (evt.patch?.status) setStatus(evt.patch.status);
        if (evt.patch?.mode?.current) setMode(evt.patch.mode.current);
        if (evt.patch?.model?.current?.modelId) setModel(evt.patch.model.current.modelId);
        if (evt.patch?.usage) setUsage(evt.patch.usage);
      } else if (evt.type === 'text') {
        const mid = evt.assistantMessageId;
        setMessages(prev => {
          if (mid != null) {
            const idx = prev.findIndex(m => m.mid === mid);
            if (idx !== -1) {
              const updated = [...prev];
              updated[idx] = { ...updated[idx], text: (updated[idx].text || '') + evt.text };
              return updated;
            }
          } else if (prev.length > 0) {
            const last = prev[prev.length - 1];
            if (last.role === 'assistant' && last.streaming) {
              const updated = [...prev];
              updated[prev.length - 1] = { ...last, text: (last.text || '') + evt.text };
              return updated;
            }
          }
          return [...prev, { role: 'assistant', text: evt.text, mid, streaming: true }];
        });
        setScrollOffset(0);
      } else if (evt.type === 'tool-call') {
        // 工具调用：按 toolCallId 去重。app-server 可能对同一次调用发多条事件，
        // 已存在则更新（而非新增），避免重复渲染。
        setMessages(prev => {
          const id = evt.toolCallId;
          if (id != null) {
            // 精确匹配已存在的同 id 工具调用
            const idx = prev.findIndex(m => m.role === 'tool' && m.toolCallId === id);
            if (idx !== -1) {
              const updated = [...prev];
              updated[idx] = {
                ...prev[idx],
                toolName: evt.toolName || prev[idx].toolName,
                toolInput: evt.toolInput || prev[idx].toolInput,
                streaming: true,
              };
              return updated;
            }
          }
          // 无 id 时兜底：合并到最后一条同名且 streaming 的 tool 消息
          if (id == null) {
            for (let i = prev.length - 1; i >= 0; i--) {
              if (prev[i].role === 'tool' && prev[i].streaming &&
                  prev[i].toolName === evt.toolName) {
                const updated = [...prev];
                updated[i] = {
                  ...prev[i],
                  toolInput: evt.toolInput || prev[i].toolInput,
                };
                return updated;
              }
            }
          }
          // 新工具调用
          return [...prev, {
            role: 'tool',
            toolName: evt.toolName,
            toolInput: evt.toolInput,
            toolCallId: id,
            result: null,
            streaming: true,
          }];
        });
        setScrollOffset(0);
      } else if (evt.type === 'tool-progress') {
        // 工具执行进度：节流更新（高频 stdout 会触发大量事件）
        const now = Date.now();
        if (now - lastProgressRef.current < 200) return; // 最多 5 次/秒
        lastProgressRef.current = now;
        setMessages(prev => {
          const id = evt.toolCallId;
          if (id == null) return prev;
          const idx = prev.findIndex(m => m.role === 'tool' && m.toolCallId === id);
          if (idx === -1) return prev;
          const updated = [...prev];
          updated[idx] = {
            ...prev[idx],
            elapsedMs: evt.elapsedMs,
            stdoutTail: evt.stdoutTail,
            stderrTail: evt.stderrTail,
            outputBytes: evt.outputBytes,
          };
          return updated;
        });
      } else if (evt.type === 'tool-result') {
        // 工具结果：按 toolCallId 精确匹配对应的工具调用消息
        setMessages(prev => {
          const id = evt.toolCallId;
          // 优先按 id 精确匹配
          if (id != null) {
            const idx = prev.findIndex(m => m.role === 'tool' && m.toolCallId === id);
            if (idx !== -1) {
              const updated = [...prev];
              updated[idx] = {
                ...prev[idx],
                result: evt.result,
                error: evt.error,
                streaming: false,
              };
              return updated;
            }
          }
          // 兜底：找最后一条 streaming 的 tool 消息
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].role === 'tool' && prev[i].streaming) {
              const updated = [...prev];
              updated[i] = {
                ...prev[i],
                result: evt.result,
                error: evt.error,
                streaming: false,
              };
              return updated;
            }
          }
          return prev;
        });
      } else if (evt.type === 'turn-start') {
        setStatus('running');
        if (evt.turnNumber) setTurnNumber(evt.turnNumber);
      } else if (evt.type === 'turn-complete') {
        setStatus('idle');
        setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m));
      }
    };
    client.on('event', onEvent);

    // server 发起的请求（如 interaction/requestPermission）：
    // server 向 client 发 {id, method, params}，client 用 {id, result} 回复。
    // 这不是 notification，是 RPC 请求（server 是 caller）。
    const onServerRequest = (msg) => {
      const parsed = normalizeEvent(msg);
      if (parsed && parsed.type === 'permission') {
        // 保留原始 JSON-RPC id（响应用），同时存 parse 出的字段
        const params = msg.params || {};
        setPermissionQueue(q => [...q, {
          ...parsed,
          rpcId: msg.id,  // JSON-RPC id，响应用
          toolName: params.toolName || parsed.toolName || 'unknown',
          input: params.input,
          reason: params.reason,
          riskLevel: params.riskLevel,
          detail: formatPermissionDetail(params),
        }]);
      } else if (parsed && parsed.type === 'user-input-request') {
        // 对齐 Claude Code 的 AskUserQuestion：渲染问题文本 + 选项列表。
        // 之前这里没有分支，导致后端发起提问时前端无任何 UI——
        // 用户只看到工具被调用，却看不到问题和选项。
        const params = msg.params || {};
        // 兼容两种字段命名：questions 数组 或 单个 question
        const questions = params.questions
          || (params.question ? [{
            header: params.header,
            question: params.question,
            options: params.options || [],
            multiSelect: !!params.multiSelect,
          }] : []);
        setQuestionQueue(q => [...q, {
          rpcId: msg.id,
          questions,
        }]);
      }
    };
    client.on('server-request', onServerRequest);

    return () => {
      if (typeof client.removeListener === 'function') {
        client.removeListener('event', onEvent);
        client.removeListener('server-request', onServerRequest);
      } else if (typeof client.off === 'function') {
        client.off('event', onEvent);
        client.off('server-request', onServerRequest);
      }
    };
  }, [client]);

  // Ctrl+C：running 时中断 turn，idle 时双击退出
  useInput((input, key) => {
    if (input !== '\x03') return;
    const now = Date.now();
    // 权限/提问对话框打开时，Ctrl+C 不退出（归对话框处理）
    if (permissionQueue.length > 0 || questionQueue.length > 0) return;
    if (isRunning) {
      if (typeof client.stop === 'function') client.stop(sessionId).catch(() => {});
      setStatus('idle');
      setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m));
      firstCtrlCRef.current = 0;
      return;
    }
    if (now - firstCtrlCRef.current < DOUBLE_PRESS_TIMEOUT_MS) {
      exit();
    } else {
      firstCtrlCRef.current = now;
    }
  });

  const handleSubmit = async (text) => {
    // 权限/提问对话框打开时禁用输入提交
    if (permissionQueue.length > 0 || questionQueue.length > 0) return;
    setMessages(prev => [...prev, { role: 'user', text }]);
    setScrollOffset(0);
    if (text.startsWith('/')) {
      const cmd = text.trim();
      if (cmd === '/quit') exit();
      // 其他斜杠命令路由到对应 RPC method
      await handleSlashCommand(cmd);
      return;
    }
    try { await client.sendMessage(sessionId, text); }
    catch (e) { setMessages(prev => [...prev, { role: 'error', text: e.message }]); }
  };

  // 斜杠命令路由
  const handleSlashCommand = async (cmd) => {
    const parts = cmd.slice(1).split(/\s+/);
    const name = parts[0];
    const arg = parts.slice(1).join(' ');
    try {
      switch (name) {
        case 'model':
          if (arg && typeof client.setModel === 'function') {
            await client.setModel(sessionId, arg);
            setModel(arg);
          }
          break;
        case 'mode':
          if (arg && typeof client.setMode === 'function') {
            await client.setMode(sessionId, arg);
            setMode(arg);
          }
          break;
        case 'compact':
          if (typeof client.compact === 'function') await client.compact(sessionId);
          break;
        case 'clear':
          setMessages([]);
          break;
        default:
          break;
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'error', text: `/${name}: ${e.message}` }]);
    }
  };

  // 权限决策：用 {id, result:{decision}} 回复 server 的 requestPermission 请求
  const handlePermissionDecide = async (decision) => {
    const current = permissionQueue[0];
    if (!current) return;
    setPermissionQueue(q => q.slice(1));
    try {
      if (typeof client.respondToServer === 'function') {
        if (decision === 'yes-always') {
          // "本工具后续全部允许"：带 permissionUpdates 持久化规则，
          // server 后续对该工具不再弹窗（对齐 app-server 的 addRules 机制）
          client.respondToServer(current.rpcId, {
            decision: 'allow',
            permissionUpdates: [{
              type: 'addRules',
              behavior: 'allow',
              rules: [{ toolName: current.toolName }],
            }],
          });
        } else {
          // decision: 'yes'→'allow', 'no'→'deny'
          const mapped = decision === 'yes' ? 'allow' : 'deny';
          client.respondToServer(current.rpcId, { decision: mapped });
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'error', text: `权限响应失败: ${e.message}` }]);
    }
  };

  // 提问响应：把用户对每个问题的回答回复给 server。
  // answers 形如 { [question文本]: label | label[] }，统一转成数组便于 server 解析。
  const handleQuestionRespond = (answers) => {
    const current = questionQueue[0];
    if (!current) return;
    setQuestionQueue(q => q.slice(1));
    try {
      if (typeof client.respondToServer === 'function') {
        // 统一成 { questionText: [answers...] } 格式
        const normalized = {};
        for (const [k, v] of Object.entries(answers || {})) {
          normalized[k] = Array.isArray(v) ? v : [v];
        }
        client.respondToServer(current.rpcId, { answers: normalized });
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'error', text: `提问响应失败: ${e.message}` }]);
    }
  };

  // 取消提问：回复 cancel
  const handleQuestionCancel = () => {
    const current = questionQueue[0];
    if (!current) return;
    setQuestionQueue(q => q.slice(1));
    try {
      if (typeof client.respondToServer === 'function') {
        client.respondToServer(current.rpcId, { cancelled: true });
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'error', text: `提问取消失败: ${e.message}` }]);
    }
  };

  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(StatusBar, { model, mode, sessionId, status, turnNumber, usage }),
    React.createElement(MessageList, { messages, scrollOffset, setScrollOffset }),
    // 交互层：权限请求 > 用户提问 > 输入框。三者互斥（对齐 Claude Code 的
    // PermissionRequest 优先占满交互区，AskUserQuestion 走同一通道）。
    // 之前 QuestionDialog 从未被渲染——三元只看 permissionQueue，导致
    // 后端发起提问时前端既无问题面板、也无输入框，用户完全看不到问题。
    questionQueue.length > 0
      ? React.createElement(QuestionDialog, {
          questions: questionQueue[0].questions || [],
          onRespond: handleQuestionRespond,
          onCancel: handleQuestionCancel,
        })
      : permissionQueue.length > 0
        ? React.createElement(PermissionDialog, {
            toolName: permissionQueue[0].toolName || 'unknown',
            detail: permissionQueue[0].detail,
            queueIndex: 1,
            queueTotal: permissionQueue.length,
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
