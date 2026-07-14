import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { StatusBar } from './StatusBar.js';
import { MessageList } from './MessageList.js';
import { InputBox } from './InputBox.js';
import { parseEvent } from '../zcode-client.js';

// Normalize whatever the client emits on 'event' into a parsed event object.
// Real ZCodeClient emits raw JSON-RPC messages ({method, params}); tests and
// other emitters may hand us an already-parsed object ({type, ...}). Detect by
// the presence of `method` to decide whether to run parseEvent.
function normalizeEvent(raw) {
  if (raw && typeof raw === 'object' && typeof raw.method === 'string') {
    return parseEvent(raw);
  }
  return raw;
}

// 双击退出的时间窗口（毫秒）。对齐 Claude Code 的 useDoublePress（800ms）。
const DOUBLE_PRESS_TIMEOUT_MS = 800;

export function App({ client, sessionId }) {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('idle');
  const [model, setModel] = useState('GLM-5.2');
  const [mode, setMode] = useState('build');
  // 滚动偏移：0 = 跟随底部（最新），>0 = 向上翻看历史
  const [scrollOffset, setScrollOffset] = useState(0);
  const { exit } = useApp();

  // 当前是否在运行一个 turn（用于 Ctrl+C 中断判断）
  const isRunning = status === 'running';
  // Ctrl+C 双击退出的首次按下时间戳
  const firstCtrlCRef = useRef(0);

  useEffect(() => {
    const onEvent = (raw) => {
      const evt = normalizeEvent(raw);
      if (!evt || typeof evt !== 'object') return;
      if (evt.type === 'state') {
        if (evt.patch?.status) setStatus(evt.patch.status);
        if (evt.patch?.mode?.current) setMode(evt.patch.mode.current);
        if (evt.patch?.model?.current?.modelId) setModel(evt.patch.model.current.modelId);
      } else if (evt.type === 'text') {
        // 流式增量合并：同一条 assistant 消息（相同 assistantMessageId）的文本增量
        // 应追加到该消息，而非每条 text 事件新建一行。
        // 设计文档第 173 行明确：assistant 文本增量实时 append。
        const mid = evt.assistantMessageId;
        setMessages(prev => {
          // 没有 mid 时退化为：尝试合并最后一条 assistant 消息
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
              updated[updated.length - 1] = { ...last, text: (last.text || '') + evt.text };
              return updated;
            }
          }
          // 新的 assistant 消息
          return [...prev, { role: 'assistant', text: evt.text, mid, streaming: true }];
        });
        // 有新内容时回到底部
        setScrollOffset(0);
      } else if (evt.type === 'turn-start') {
        setStatus('running');
      } else if (evt.type === 'turn-complete') {
        setStatus('idle');
        // 标记所有 assistant 消息为已完成（停止 streaming 状态）
        setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m));
      } else if (evt.type === 'permission') {
        setMessages(prev => [...prev, { role: 'tool', name: 'permission', text: 'requested' }]);
      }
    };
    client.on('event', onEvent);
    return () => {
      if (typeof client.removeListener === 'function') client.removeListener('event', onEvent);
      else if (typeof client.off === 'function') client.off('event', onEvent);
    };
  }, [client]);

  // Ctrl+C 行为（对齐 Claude Code 的"先中断后退出"机制）：
  // - 有 turn 在跑时：第一次 Ctrl+C 中断当前 turn（session/stop），不退出
  // - 空闲时：第一次 Ctrl+C 记录时间，800ms 内第二次 Ctrl+C 才退出程序
  useInput((input, key) => {
    if (input !== '\x03') return; // 只处理 Ctrl+C
    const now = Date.now();
    if (isRunning) {
      // 中断当前 turn
      if (typeof client.stop === 'function') {
        client.stop(sessionId).catch(() => {});
      }
      setStatus('idle');
      setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m));
      firstCtrlCRef.current = 0; // 中断不进入双击退出流程
      return;
    }
    // 空闲：双击退出
    if (now - firstCtrlCRef.current < DOUBLE_PRESS_TIMEOUT_MS) {
      exit();
    } else {
      firstCtrlCRef.current = now;
    }
  });

  const handleSubmit = async (text) => {
    setMessages(prev => [...prev, { role: 'user', text }]);
    setScrollOffset(0);
    if (text.startsWith('/')) {
      if (text.trim() === '/quit') exit();
      return;
    }
    try { await client.sendMessage(sessionId, text); }
    catch (e) { setMessages(prev => [...prev, { role: 'error', text: e.message }]); }
  };

  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(StatusBar, { model, mode, sessionId, status }),
    React.createElement(MessageList, { messages, scrollOffset, setScrollOffset }),
    React.createElement(InputBox, { onSubmit: handleSubmit }),
    React.createElement(Text, { dimColor: true }, isRunning
      ? '[Ctrl+C] 中断当前任务'
      : '[Ctrl+C×2] quit  [/quit] quit')
  );
}
