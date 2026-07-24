import React, { memo } from 'react';
import { Text, Box } from 'ink';
import { Markdown, StreamingMarkdown } from './markdown/Markdown.js';
import { ToolUse } from './components/ToolUse.js';

/**
 * 单条消息渲染（user/tool/error/assistant），
 * 供 <Static> 历史区与动态 MessageList 共用。
 */
export const MessageItem = memo(function MessageItem({ message: m }) {
  if (m.role === 'user') {
    return React.createElement(Text, { color: 'green' }, `user: ${m.text}`);
  }
  if (m.role === 'tool') {
    return React.createElement(ToolUse, {
      toolName: m.toolName || m.name || 'unknown',
      toolInput: m.toolInput,
      result: m.result,
      error: m.error,
      streaming: m.streaming,
      elapsedMs: m.elapsedMs,
      stdoutTail: m.stdoutTail,
      stderrTail: m.stderrTail,
      outputBytes: m.outputBytes,
    });
  }
  if (m.role === 'error') {
    return React.createElement(Text, { color: 'red' }, `error: ${m.text}`);
  }
  // assistant 消息：streaming 用 StreamingMarkdown，完成用 Markdown
  const indicator = m.streaming ? '▌' : '●';
  const content = m.streaming
    ? React.createElement(StreamingMarkdown, null, m.text || '')
    : React.createElement(Markdown, null, m.text || '');
  const reasoningBlock = m.reasoning ? (
    m.reasoningExpanded
      ? React.createElement(Box, { flexDirection: 'column', marginBottom: 0 },
          React.createElement(Text, { dimColor: true, italic: true }, '∴ Thinking (Ctrl+O 折叠)'),
          React.createElement(Box, { paddingLeft: 2 },
            React.createElement(Markdown, null, m.reasoning)
          )
        )
      : React.createElement(Text, { dimColor: true, italic: true },
          `∴ Thinking (${m.reasoning.length} 字符, Ctrl+O 展开)`)
  ) : null;
  return React.createElement(
    Box,
    { flexDirection: 'row' },
    React.createElement(Text, { color: m.streaming ? 'yellow' : 'cyan' }, indicator + ' '),
    React.createElement(Box, { flexDirection: 'column' },
      reasoningBlock,
      content
    )
  );
});

export default MessageItem;
