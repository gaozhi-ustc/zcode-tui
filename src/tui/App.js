import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { StatusBar } from './StatusBar.js';
import { MessageList } from './MessageList.js';
import { InputBox } from './InputBox.js';
import { ToolUse } from './components/ToolUse.js';
import { PermissionDialog } from './components/PermissionDialog.js';
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
  const { exit } = useApp();

  const isRunning = status === 'running';
  const firstCtrlCRef = useRef(0);

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
        // 添加工具调用消息（进行中状态）
        setMessages(prev => [...prev, {
          role: 'tool',
          toolName: evt.toolName,
          toolInput: evt.toolInput,
          toolCallId: evt.toolCallId,
          result: null,
          streaming: true,
        }]);
        setScrollOffset(0);
      } else if (evt.type === 'tool-result') {
        // 更新对应的工具调用消息为已完成
        setMessages(prev => {
          // 找最后一条匹配的 tool 消息
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
    // 权限对话框打开时，Ctrl+C 不退出（归对话框处理）
    if (permissionQueue.length > 0) return;
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
    // 权限对话框打开时禁用输入提交
    if (permissionQueue.length > 0) return;
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
        // decision: 'yes'→'allow', 'no'→'deny'（对齐 app-server 的 Ux schema）
        const mapped = decision === 'yes' ? 'allow' : 'deny';
        client.respondToServer(current.rpcId, { decision: mapped });
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'error', text: `权限响应失败: ${e.message}` }]);
    }
  };

  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(StatusBar, { model, mode, sessionId, status, turnNumber, usage }),
    React.createElement(MessageList, { messages, scrollOffset, setScrollOffset }),
    permissionQueue.length > 0
      ? React.createElement(PermissionDialog, {
          toolName: permissionQueue[0].toolName || permissionQueue[0].params?.toolName || 'unknown',
          detail: permissionQueue[0].detail || permissionQueue[0].params?.detail,
          onDecide: handlePermissionDecide,
        })
      : React.createElement(InputBox, { onSubmit: handleSubmit }),
    React.createElement(Text, { dimColor: true }, isRunning
      ? '[Ctrl+C] 中断当前任务'
      : permissionQueue.length > 0
        ? '[y] 允许  [n] 拒绝'
        : '[Ctrl+C×2] quit  [/quit] quit  [/clear] 清屏')
  );
}
