import { useState, useEffect, useRef, useCallback } from 'react';
import { parseEvent } from '../zcode-client.js';

/** Normalize raw event into parsed event object. */
function normalizeEvent(raw) {
  if (raw && typeof raw === 'object' && typeof raw.method === 'string') {
    return parseEvent(raw);
  }
  return raw;
}

/** 找最后一条 streaming tool 消息的工具名。 */
export function getLastStreamingToolName(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'tool' && messages[i].streaming) {
      return messages[i].toolName || null;
    }
  }
  return null;
}

/**
 * 会话事件管理 hook。
 * 把 App.js 的事件监听、消息/状态/权限/提问管理收口到一处。
 *
 * @param {object} client - ZCodeClient 实例
 * @param {string} sessionId
 * @param {Array} initialMessages - resume 的历史消息
 * @returns {object} 所有状态和操作方法
 */
export function useSessionEvents(client, sessionId, initialMessages = []) {
  const [messages, setMessages] = useState(initialMessages);
  const [status, setStatus] = useState('idle');
  const [model, setModel] = useState('GLM-5.2');
  const [mode, setMode] = useState('build');
  const [turnNumber, setTurnNumber] = useState(0);
  const [usage, setUsage] = useState(null);
  const [permissionQueue, setPermissionQueue] = useState([]);
  const [questionQueue, setQuestionQueue] = useState([]);
  const [turnStartTime, setTurnStartTime] = useState(0);
  const [responseLength, setResponseLength] = useState(0);
  const respondedRpcIdsRef = useRef(new Set());

  useEffect(() => {
    const onEvent = (raw) => {
      const evt = normalizeEvent(raw);
      if (!evt || typeof evt !== 'object') return;
      handleEvent(evt);
    };

    const handleEvent = (evt) => {
      if (evt.type === 'state') {
        if (evt.patch?.status) setStatus(evt.patch.status);
        if (evt.patch?.mode?.current) setMode(evt.patch.mode.current);
        if (evt.patch?.model?.current?.modelId) setModel(evt.patch.model.current.modelId);
        if (evt.patch?.usage) setUsage(evt.patch.usage);
      } else if (evt.type === 'text') {
        if (evt.text) setResponseLength(prev => prev + evt.text.length);
        setMessages(prev => mergeTextDelta(prev, evt));
      } else if (evt.type === 'tool-call') {
        setMessages(prev => mergeToolCall(prev, evt));
      } else if (evt.type === 'tool-result') {
        setMessages(prev => mergeToolResult(prev, evt));
      } else if (evt.type === 'turn-start') {
        setStatus('running');
        if (evt.turnNumber) setTurnNumber(evt.turnNumber);
        setTurnStartTime(Date.now());
        setResponseLength(0);
      } else if (evt.type === 'turn-complete') {
        setStatus('idle');
        setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m));
        setTurnStartTime(0);
        if (evt.usage) setUsage(evt.usage);
      } else if (evt.type === 'usage') {
        if (evt.usage) setUsage(evt.usage);
      } else if (evt.type === 'session-model') {
        if (evt.model?.modelId) setModel(evt.model.modelId);
      }
    };

    // server 发起的请求（权限/提问）
    const onServerRequest = (msg) => {
      const parsed = normalizeEvent(msg);
      if (parsed?.type === 'permission') {
        const params = msg.params || {};
        setPermissionQueue(q => {
          if (q.some(item => item.rpcId === msg.id)) return q;
          return [...q, {
            ...parsed,
            rpcId: msg.id,
            toolName: params.toolName || parsed.toolName || 'unknown',
            input: params.input,
            reason: params.reason,
            riskLevel: params.riskLevel,
            detail: formatPermissionDetail(params),
          }];
        });
      } else if (parsed?.type === 'user-input-request') {
        const params = msg.params || {};
        const questions = params.questions || (params.question ? [{
          header: params.header, question: params.question,
          options: params.options || [], multiSelect: !!params.multiSelect,
        }] : []);
        setQuestionQueue(q => {
          if (q.some(item => item.rpcId === msg.id)) return q;
          return [...q, { rpcId: msg.id, questions }];
        });
      }
    };

    client.on('event', onEvent);
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

  // === 消息操作 ===
  const addUserMessage = useCallback((text) => {
    setMessages(prev => [...prev, { role: 'user', text }]);
  }, []);

  const addErrorMessage = useCallback((text) => {
    setMessages(prev => [...prev, { role: 'error', text }]);
  }, []);

  const clearMessages = useCallback(() => setMessages([]), []);

  // === 权限操作 ===
  const decidePermission = useCallback((decision) => {
    const current = permissionQueue[0];
    if (!current) return null;
    if (respondedRpcIdsRef.current.has(current.rpcId)) return null;
    respondedRpcIdsRef.current.add(current.rpcId);
    setPermissionQueue(q => q.slice(1));
    return { rpcId: current.rpcId, decision, toolName: current.toolName, input: current.input };
  }, [permissionQueue]);

  // === 提问操作 ===
  const respondQuestion = useCallback((answers) => {
    const current = questionQueue[0];
    if (!current) return null;
    if (respondedRpcIdsRef.current.has(current.rpcId)) return null;
    respondedRpcIdsRef.current.add(current.rpcId);
    setQuestionQueue(q => q.slice(1));
    return { rpcId: current.rpcId, answers };
  }, [questionQueue]);

  const cancelQuestion = useCallback(() => {
    const current = questionQueue[0];
    if (!current) return null;
    if (respondedRpcIdsRef.current.has(current.rpcId)) return null;
    respondedRpcIdsRef.current.add(current.rpcId);
    setQuestionQueue(q => q.slice(1));
    return { rpcId: current.rpcId };
  }, [questionQueue]);

  return {
    messages, status, model, mode, turnNumber, usage,
    permissionQueue, questionQueue,
    turnStartTime, responseLength,
    isRunning: status === 'running',
    hasActiveTools: messages.some(m => m.role === 'tool' && m.streaming),
    currentToolName: getLastStreamingToolName(messages),
    addUserMessage, addErrorMessage, clearMessages,
    setModel, setStatus,
    decidePermission, respondQuestion, cancelQuestion,
  };
}

// === 消息合并辅助函数 ===

function mergeTextDelta(prev, evt) {
  const mid = evt.assistantMessageId;
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
}

function mergeToolCall(prev, evt) {
  const id = evt.toolCallId;
  if (id != null) {
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
  return [...prev, {
    role: 'tool', toolName: evt.toolName, toolInput: evt.toolInput,
    toolCallId: id, result: null, streaming: true,
  }];
}

function mergeToolResult(prev, evt) {
  const id = evt.toolCallId;
  if (id != null) {
    const idx = prev.findIndex(m => m.role === 'tool' && m.toolCallId === id);
    if (idx !== -1) {
      const updated = [...prev];
      updated[idx] = { ...prev[idx], result: evt.result, error: evt.error, streaming: false };
      return updated;
    }
  }
  for (let i = prev.length - 1; i >= 0; i--) {
    if (prev[i].role === 'tool' && prev[i].streaming) {
      const updated = [...prev];
      updated[i] = { ...prev[i], result: evt.result, error: evt.error, streaming: false };
      return updated;
    }
  }
  return prev;
}

// === 权限详情格式化 ===

function formatPermissionDetail(params) {
  const { toolName, input, reason, riskLevel } = params;
  const parts = [];
  if (riskLevel) {
    const label = { high: '⚠️ 高风险', medium: '🔶 中风险', low: '🟢 低风险' }[riskLevel] || riskLevel;
    parts.push(label);
  }
  if (input && typeof input === 'object') {
    const detail = extractToolAction(toolName, input);
    if (detail) parts.push(detail);
  }
  if (reason) parts.push(reason);
  return parts.join('\n');
}

function extractToolAction(toolName, input) {
  const cmd = input.command || input.cmd;
  const filePath = input.file_path || input.filePath || input.path;
  if (cmd) return `$ ${cmd}`;
  if (filePath && input.old_string != null) return `编辑文件: ${filePath}`;
  if (filePath && input.content != null) return `写入文件: ${filePath}`;
  if (filePath) return `访问文件: ${filePath}`;
  if (input.pattern || input.query) return `${toolName}: ${input.pattern || input.query}`;
  if (input.url) return `访问: ${input.url}`;
  return toolName || '';
}

function buildRuleContent(input) {
  if (!input || typeof input !== 'object') return {};
  for (const key of ['command', 'url', 'file_path', 'path', 'pattern']) {
    const val = input[key];
    if (typeof val === 'string' && val.trim()) return { ruleContent: val };
  }
  return {};
}

export { formatPermissionDetail, buildRuleContent };
