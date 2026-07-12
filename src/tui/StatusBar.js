import React from 'react';
import { Text, Box } from 'ink';

export function StatusBar({ model, mode, sessionId, status }) {
  const shortId = sessionId ? sessionId.slice(0, 12) : 'no-session';
  return React.createElement(Box, { flexDirection: 'row', gap: 2 },
    React.createElement(Text, { bold: true, color: 'cyan' }, 'ZCode'),
    React.createElement(Text, { dimColor: true }, shortId),
    React.createElement(Text, null, `model: ${model || '?'}`),
    React.createElement(Text, null, `mode: ${mode || '?'}`),
    React.createElement(Text, { color: status === 'running' ? 'yellow' : 'green' }, status || 'idle')
  );
}
