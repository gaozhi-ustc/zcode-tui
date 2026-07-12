import React, { useState, useEffect } from 'react';
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

export function App({ client, sessionId }) {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('idle');
  const [model, setModel] = useState('GLM-5.2');
  const [mode, setMode] = useState('build');
  const { exit } = useApp();

  useEffect(() => {
    const onEvent = (raw) => {
      const evt = normalizeEvent(raw);
      if (!evt || typeof evt !== 'object') return;
      if (evt.type === 'state') {
        if (evt.patch?.status) setStatus(evt.patch.status);
        if (evt.patch?.mode?.current) setMode(evt.patch.mode.current);
        if (evt.patch?.model?.current?.modelId) setModel(evt.patch.model.current.modelId);
      } else if (evt.type === 'text') {
        setMessages(prev => [...prev, { role: 'assistant', text: evt.text, mid: evt.assistantMessageId }]);
      } else if (evt.type === 'turn-complete') {
        setStatus('idle');
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

  useInput((input) => {
    if (input === '\x03') exit(); // Ctrl+C
  });

  const handleSubmit = async (text) => {
    setMessages(prev => [...prev, { role: 'user', text }]);
    if (text.startsWith('/')) {
      if (text.trim() === '/quit') exit();
      return;
    }
    try { await client.sendMessage(sessionId, text); }
    catch (e) { setMessages(prev => [...prev, { role: 'error', text: e.message }]); }
  };

  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(StatusBar, { model, mode, sessionId, status }),
    React.createElement(MessageList, { messages }),
    React.createElement(InputBox, { onSubmit: handleSubmit }),
    React.createElement(Text, { dimColor: true }, '[Ctrl+C] quit  [/quit] quit')
  );
}
