import { useState, useEffect, useRef, useCallback } from 'react';
import { parseEvent } from '../zcode-client.js';
import { classifyPermission } from './auto-mode.js';
import { sanitizeText } from './sanitize.js';

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
  const [mode, setModeState] = useState('build');
  const [turnNumber, setTurnNumber] = useState(0);
  const [usage, setUsage] = useState(null);
  const [permissionQueue, setPermissionQueue] = useState([]);
  const [questionQueue, setQuestionQueue] = useState([]);
  const [autoModeEnabled, setAutoModeEnabledState] = useState(false);
  const [yoloModeEnabled, setYoloModeEnabledState] = useState(false);
  const [turnStartTime, setTurnStartTime] = useState(0);
  const [responseLength, setResponseLength] = useState(0);
  const modeRef = useRef(mode);
  const autoModeEnabledRef = useRef(autoModeEnabled);
  const yoloModeEnabledRef = useRef(yoloModeEnabled);
  const respondedRpcIdsRef = useRef(new Set());
  // broker 重播每次换新 rpcId（zcode.cjs: server-${nextId++} 指数退避），
  // 回答任一 id 都解析整个逻辑请求。按内容追踪最新 id，回答发给存活 id。
  const latestRequestIdsRef = useRef(new Map()); // contentKey → 最新 rpcId

  const setMode = useCallback((nextMode) => {
    modeRef.current = nextMode;
    setModeState(nextMode);
  }, []);

  const setAutoModeEnabled = useCallback((value) => {
    const next = typeof value === 'function' ? value(autoModeEnabledRef.current) : value;
    autoModeEnabledRef.current = next;
    setAutoModeEnabledState(next);
    return next;
  }, []);

  const setYoloModeEnabled = useCallback((value) => {
    const next = typeof value === 'function' ? value(yoloModeEnabledRef.current) : value;
    yoloModeEnabledRef.current = next;
    setYoloModeEnabledState(next);
    return next;
  }, []);

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
      } else if (evt.type === 'reasoning-start') {
        // 推理过程开始：创建/更新一条 assistant 消息，标记有 reasoning
        setMessages(prev => {
          const idx = prev.findIndex(m => m.mid === evt.assistantMessageId);
          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], reasoning: '', reasoningExpanded: false };
            return updated;
          }
          return [...prev, { role: 'assistant', text: '', mid: evt.assistantMessageId, streaming: true, reasoning: '', reasoningExpanded: false }];
        });
      } else if (evt.type === 'reasoning') {
        // 推理增量：追加到对应消息的 reasoning 字段
        setMessages(prev => {
          const idx = prev.findIndex(m => m.mid === evt.assistantMessageId);
          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], reasoning: (updated[idx].reasoning || '') + sanitizeText(evt.text) };
            return updated;
          }
          return prev;
        });
      } else if (evt.type === 'reasoning-end') {
        // 推理结束：不特殊处理，reasoning 已存好
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
      // 已响应请求的重播（broker 每 1s reannounce）直接忽略：
      // 否则回答后重播会复活对话框，且因 respondedRef 残留形成永久死锁（现场 bug）
      if (msg?.id != null && respondedRpcIdsRef.current.has(msg.id)) return;

      // 同内容未决请求入队去重：重播只更新最新 rpcId，队列不膨胀
      const enqueueUnique = (setQueue, item) => {
        const key = requestContentKey(item);
        latestRequestIdsRef.current.set(key, item.rpcId);
        setQueue(q => {
          if (q.some(i => i.rpcId === item.rpcId || requestContentKey(i) === key)) return q;
          return [...q, item];
        });
      };
      if (parsed?.type === 'permission') {
        const params = msg.params || {};
        const permItem = {
          ...parsed,
          rpcId: msg.id,
          toolName: params.toolName || parsed.toolName || 'unknown',
          input: params.input,
          reason: params.reason,
          riskLevel: params.riskLevel,
          detail: formatPermissionDetail(params),
        };

        // yolo mode：全部自动批准（不调 LLM，最快）
        if (yoloModeEnabledRef.current || modeRef.current === 'yolo') {
          respondedRpcIdsRef.current.add(msg.id);
          client.respondToServer(msg.id, { decision: 'allow' });
          setMessages(prev => [...prev, {
            role: 'tool',
            toolName: permItem.toolName,
            toolInput: permItem.input,
            toolCallId: permItem.rpcId,
            result: { success: true, content: '✓ yolo 自动批准' },
            error: false,
            streaming: false,
          }]);
        }
        // auto mode：先调 LLM 分类器判断，allow 则自动回复，block 则进人工队列
        else if (autoModeEnabledRef.current || modeRef.current === 'auto') {
          classifyPermission(permItem.toolName, permItem.input, permItem.riskLevel)
            .then(result => {
              if (!result.shouldBlock) {
                // 自动允许
                respondedRpcIdsRef.current.add(msg.id);
                client.respondToServer(msg.id, { decision: 'allow' });
                setMessages(prev => [...prev, {
                  role: 'tool',
                  toolName: permItem.toolName,
                  toolInput: permItem.input,
                  toolCallId: permItem.rpcId,
                  result: { success: true, content: `✓ 自动批准: ${result.reason}` },
                  error: false,
                  streaming: false,
                }]);
              } else {
                // block：进人工授权队列
                enqueueUnique(setPermissionQueue, permItem);
              }
            })
            .catch(() => {
              // 分类器异常 → fail-closed → 进人工队列
              enqueueUnique(setPermissionQueue, permItem);
            });
        } else {
          // 非 auto mode：直接进人工授权队列
          enqueueUnique(setPermissionQueue, permItem);
        }
      } else if (parsed?.type === 'user-input-request') {
        const params = msg.params || {};
        const questions = params.questions || (params.question ? [{
          header: params.header, question: params.question,
          options: params.options || [], multiSelect: !!params.multiSelect,
        }] : []);
        enqueueUnique(setQuestionQueue, { rpcId: msg.id, questions });
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

  // 切换最后一条含 reasoning 的 assistant 消息的展开/折叠
  const toggleReasoning = useCallback(() => {
    setMessages(prev => {
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === 'assistant' && prev[i].reasoning) {
          const updated = [...prev];
          updated[i] = { ...prev[i], reasoningExpanded: !prev[i].reasoningExpanded };
          return updated;
        }
      }
      return prev;
    });
  }, []);

  // 回答时使用的 rpcId：重播场景下发给最新存活 id
  const resolveRpcId = (item) =>
    latestRequestIdsRef.current.get(requestContentKey(item)) ?? item.rpcId;

  // === 权限操作 ===
  const decidePermission = useCallback((decision) => {
    const current = permissionQueue[0];
    if (!current) return null;
    const rpcId = resolveRpcId(current);
    if (respondedRpcIdsRef.current.has(rpcId) || respondedRpcIdsRef.current.has(current.rpcId)) {
      // 重放的已响应请求：出队避免对话框卡死，但不重复回复
      setPermissionQueue(q => q.slice(1));
      return null;
    }
    respondedRpcIdsRef.current.add(rpcId);
    respondedRpcIdsRef.current.add(current.rpcId);
    setPermissionQueue(q => q.slice(1));
    return { rpcId, decision, toolName: current.toolName, input: current.input };
  }, [permissionQueue]);

  // === 提问操作 ===
  const respondQuestion = useCallback((answers) => {
    const current = questionQueue[0];
    if (!current) return null;
    const rpcId = resolveRpcId(current);
    if (respondedRpcIdsRef.current.has(rpcId) || respondedRpcIdsRef.current.has(current.rpcId)) {
      // 重放的已响应请求：出队避免对话框卡死，但不重复回复
      setQuestionQueue(q => q.slice(1));
      return null;
    }
    respondedRpcIdsRef.current.add(rpcId);
    respondedRpcIdsRef.current.add(current.rpcId);
    setQuestionQueue(q => q.slice(1));
    return { rpcId, answers };
  }, [questionQueue]);

  const cancelQuestion = useCallback(() => {
    const current = questionQueue[0];
    if (!current) return null;
    const rpcId = resolveRpcId(current);
    if (respondedRpcIdsRef.current.has(rpcId) || respondedRpcIdsRef.current.has(current.rpcId)) {
      setQuestionQueue(q => q.slice(1));
      return null;
    }
    respondedRpcIdsRef.current.add(rpcId);
    respondedRpcIdsRef.current.add(current.rpcId);
    setQuestionQueue(q => q.slice(1));
    return { rpcId };
  }, [questionQueue]);

  return {
    messages, status, model, mode, turnNumber, usage,
    permissionQueue, questionQueue,
    autoModeEnabled, setAutoModeEnabled,
    yoloModeEnabled, setYoloModeEnabled,
    turnStartTime, responseLength,
    isRunning: status === 'running',
    hasActiveTools: messages.some(m => m.role === 'tool' && m.streaming),
    currentToolName: getLastStreamingToolName(messages),
    addUserMessage, addErrorMessage, clearMessages,
    toggleReasoning,
    setModel, setStatus,
    decidePermission, respondQuestion, cancelQuestion,
  };
}

// === 消息合并辅助函数 ===

function mergeTextDelta(prev, evt) {
  const mid = evt.assistantMessageId;
  const delta = sanitizeText(evt.text); // 净化 \r/ANSI（远程 pty 捕获内容）
  if (mid != null) {
    const idx = prev.findIndex(m => m.mid === mid);
    if (idx !== -1) {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], text: (updated[idx].text || '') + delta };
      return updated;
    }
  } else if (prev.length > 0) {
    const last = prev[prev.length - 1];
    if (last.role === 'assistant' && last.streaming) {
      const updated = [...prev];
      updated[prev.length - 1] = { ...last, text: (last.text || '') + delta };
      return updated;
    }
  }
  return [...prev, { role: 'assistant', text: delta, mid, streaming: true }];
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

/** 请求内容键：broker 重播（新 rpcId、同 method+params）按此去重。 */
function requestContentKey(item) {
  if (item?.questions) return `question:${JSON.stringify(item.questions)}`;
  return `permission:${item?.toolName || ''}:${JSON.stringify(item?.input || {})}`;
}

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
