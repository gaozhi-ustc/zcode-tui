import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { StatusBar } from './StatusBar.js';
import { MessageList } from './MessageList.js';
import { InputBox } from './InputBox.js';
import { ToolUse } from './components/ToolUse.js';
import { PermissionDialog } from './components/PermissionDialog.js';
import { ModelPicker } from './components/ModelPicker.js';
import { Spinner } from './components/Spinner.js';
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

/**
 * 从工具 input 里提取 ruleContent（匹配规则内容）。
 * 对齐 app-server 的 ruleContentFromPermissionInput（t3o）：
 * 按 ["command","url","file_path","path","pattern"] 优先级取第一个非空字段。
 */
function buildRuleContent(input) {
  if (!input || typeof input !== 'object') return {};
  for (const key of ['command', 'url', 'file_path', 'path', 'pattern']) {
    const val = input[key];
    if (typeof val === 'string' && val.trim()) {
      return { ruleContent: val };
    }
  }
  return {};
}

/** 从消息列表找最后一条 streaming 的 tool 消息的工具名。 */
function getLastStreamingToolName(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'tool' && messages[i].streaming) {
      return messages[i].toolName || null;
    }
  }
  return null;
}

const DOUBLE_PRESS_TIMEOUT_MS = 800;

export function App({ client, sessionId, initialMessages = [], runtimeModel = null }) {
  const [messages, setMessages] = useState(initialMessages);
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
  // resume 后的首条消息带 runtimeModel 清除 restoreWarning，清除一次即可
  const runtimeModelRef = useRef(runtimeModel);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const [turnStartTime, setTurnStartTime] = useState(0);
  const [responseLength, setResponseLength] = useState(0);

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
        // 累加响应长度（用于 spinner 的 token 估算）
        if (evt.text) setResponseLength(prev => prev + evt.text.length);
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
        setTurnStartTime(Date.now());
        setResponseLength(0);
      } else if (evt.type === 'turn-complete') {
        setStatus('idle');
        setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m));
        setTurnStartTime(0);
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
        setQuestionQueue(q => {
          // 防重复：同一个 rpcId 的问题不重复加入
          if (q.some(item => item.rpcId === msg.id)) return q;
          return [...q, { rpcId: msg.id, questions }];
        });
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

  // 对话框打开时禁用其他所有 useInput，避免按键竞争
  const dialogActive = permissionQueue.length > 0 || questionQueue.length > 0;

  // Ctrl+C：running 时中断 turn，idle 时双击退出（对话框打开时停用）
  useInput((input, key) => {
    if (input !== '\x03') return;
    const now = Date.now();
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
  }, { isActive: !dialogActive });

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
    try {
      // resume 后首条消息带 runtimeModel 清除 restoreWarning
      if (runtimeModelRef.current) {
        await client.sendMessage(sessionId, text, runtimeModelRef.current);
        runtimeModelRef.current = null; // 清除一次即可，后续不带
      } else {
        await client.sendMessage(sessionId, text);
      }
    } catch (e) {
      const errMsg = e.message || JSON.stringify(e);
      if (errMsg.includes('模型') && errMsg.includes('不可用') || e.code === -32031) {
        setMessages(prev => [...prev, { role: 'error', text: '模型不可用，请用 /model 选择模型' }]);
        setModelPickerOpen(true);
      } else {
        setMessages(prev => [...prev, { role: 'error', text: errMsg }]);
      }
    }
  };

  // 斜杠命令路由
  const handleSlashCommand = async (cmd) => {
    const parts = cmd.slice(1).split(/\s+/);
    const name = parts[0];
    const arg = parts.slice(1).join(' ');
    try {
      switch (name) {
        case 'model':
          if (arg) {
            // 直接指定模型：/model GLM-5.2（先查 modelCatalog 拿完整 ref）
            if (typeof client.setModel === 'function') {
              try {
                const models = typeof client.getAvailableModels === 'function'
                  ? await client.getAvailableModels() : [];
                const found = models.find(m => (m.ref?.modelId || m.label) === arg);
                await client.setModel(sessionId, found?.ref || { providerId: '', modelId: arg });
                setModel(arg);
              } catch (e) {
                setMessages(prev => [...prev, { role: 'error', text: `切换模型失败: ${e.message}` }]);
              }
            }
          } else {
            // 无参数：加载可用模型并弹出选择列表
            try {
              if (typeof client.getAvailableModels === 'function') {
                const models = await client.getAvailableModels();
                setAvailableModels(models);
              }
            } catch (e) {
              setMessages(prev => [...prev, { role: 'error', text: `获取模型列表失败: ${e.message}` }]);
            }
            setModelPickerOpen(true);
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
    // 防重复：同一个 rpcId 只响应一次
    if (respondedRpcIdsRef.current.has(current.rpcId)) return;
    respondedRpcIdsRef.current.add(current.rpcId);
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
              rules: [{
                toolName: current.toolName,
                // ruleContent：对齐 app-server 的 ruleContentFromPermissionInput，
                // 从 input 里取 command/url/file_path/path/pattern 作为匹配规则
                ...buildRuleContent(current.input),
              }],
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

  // 提问响应：把用户对每个问题的回答回复给 server，并回显选择内容。
  // respondedRpcIds 防止重复响应（Enter 多次触发或事件重发）
  const respondedRpcIdsRef = useRef(new Set());
  const handleQuestionRespond = (answers) => {
    const current = questionQueue[0];
    if (!current) return;
    // 防重复：同一个 rpcId 只响应一次
    if (respondedRpcIdsRef.current.has(current.rpcId)) return;
    respondedRpcIdsRef.current.add(current.rpcId);
    setQuestionQueue(q => q.slice(1));

    // 回显用户的选择（让用户看到自己选了什么）
    const answerLines = [];
    for (const [question, answer] of Object.entries(answers || {})) {
      const labels = Array.isArray(answer) ? answer : [answer];
      const qShort = question.length > 60 ? question.slice(0, 57) + '...' : question;
      answerLines.push(`${qShort}: ${labels.join(', ')}`);
    }
    if (answerLines.length > 0) {
      setMessages(prev => [...prev, { role: 'user', text: answerLines.join('\n') }]);
      setScrollOffset(0);
    }

    try {
      if (typeof client.respondToServer === 'function') {
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
    React.createElement(MessageList, { messages, scrollOffset, setScrollOffset, inputDisabled: dialogActive || modelPickerOpen }),
    // Spinner 行：agent 工作时显示动画 + 动词 + 耗时 + token（对齐 Claude Code）
    // 从 messages 提取当前执行的工具名和是否有活跃工具
    React.createElement(Spinner, {
      active: isRunning && !dialogActive && !modelPickerOpen,
      startTime: turnStartTime,
      responseLength,
      usage,
      currentToolName: getLastStreamingToolName(messages),
      hasActiveTools: messages.some(m => m.role === 'tool' && m.streaming),
    }),
    // 模型选择面板（/model 无参数时弹出，优先级最高）
    modelPickerOpen
      ? React.createElement(ModelPicker, {
          models: availableModels,
          currentModel: model,
          onSelect: async (m) => {
            try {
              const ref = m.ref || { providerId: '', modelId: m.label };
              // 先用 setModel 设置模型引用
              if (typeof client.setModel === 'function') {
                await client.setModel(sessionId, ref);
              }
              // 再用 updateRuntimeModelConfig 触发 deferred model adapter 初始化
              // （resume 后模型不可用时，app-server 延迟创建 adapter，需要这个调用激活）
              try {
                await client.send('session/updateRuntimeModelConfig', {
                  sessionId,
                  runtimeModel: ref,
                  applyModelSelection: true,
                });
              } catch {}
              setModel(m.ref?.modelId || m.label);
              setMessages(prev => [...prev, { role: 'tool', toolName: 'ModelSwitch', toolInput: {}, result: `已切换到 ${m.ref?.modelId || m.label}`, streaming: false }]);
            } catch (e) {
              setMessages(prev => [...prev, { role: 'error', text: `切换模型失败: ${e.message}` }]);
            }
            setModelPickerOpen(false);
          },
          onCancel: () => setModelPickerOpen(false),
        })
      : questionQueue.length > 0
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
