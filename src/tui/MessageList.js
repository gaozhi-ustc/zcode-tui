import React from 'react';
import { Text, Box } from 'ink';

export function MessageList({ messages }) {
  const items = (messages || []).map((m, i) => {
    if (m.role === 'user') return React.createElement(Text, { key: i, color: 'green' }, `user: ${m.text}`);
    if (m.role === 'tool') return React.createElement(Text, { key: i, dimColor: true }, `  [tool] ${m.name}: ${m.text}`);
    if (m.role === 'error') return React.createElement(Text, { key: i, color: 'red' }, `error: ${m.text}`);
    return React.createElement(Text, { key: i }, `assistant: ${m.text}`);
  });
  return React.createElement(Box, { flexDirection: 'column' }, ...items);
}
