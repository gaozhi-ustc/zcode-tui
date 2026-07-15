import React from 'react';
import { Text, Box } from 'ink';

/**
 * 状态栏（对齐 Claude Code 的 StatusLine / PromptInputFooterLeftSide）。
 * 显示：ZCode 品牌、workspace、model、mode、turn 号、token 用量、状态。
 */
export function StatusBar({ model, mode, sessionId, status, turnNumber, usage, workspace }) {
  const shortId = sessionId ? sessionId.slice(0, 12) : 'no-session';
  const cwd = workspace || process.cwd();
  const shortCwd = cwd.replace(process.env.HOME || '', '~');

  return React.createElement(
    Box,
    { flexDirection: 'row', gap: 2, flexShrink: 0 },
    React.createElement(Text, { bold: true, color: 'cyan' }, 'ZCode'),
    React.createElement(Text, { dimColor: true }, shortCwd),
    React.createElement(Text, null, `model: ${model || '?'}`),
    React.createElement(Text, null, `mode: ${mode || '?'}`),
    turnNumber != null && turnNumber > 0 && React.createElement(Text, { dimColor: true }, `turn: ${turnNumber}`),
    usage && usage.inputTokens != null && React.createElement(
      Text,
      { dimColor: true },
      formatTokens(usage.inputTokens)
    ),
    React.createElement(
      Text,
      { color: status === 'running' ? 'yellow' : 'green' },
      status === 'running' ? '● running' : '● idle'
    )
  );
}

function formatTokens(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M tok`;
  if (n >= 1000) return `${Math.round(n / 1000)}k tok`;
  return `${n} tok`;
}

export default StatusBar;
