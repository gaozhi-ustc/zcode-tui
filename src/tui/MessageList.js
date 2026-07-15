import React, { memo } from 'react';
import { Text, Box, useInput, useStdout } from 'ink';
import { Markdown, StreamingMarkdown } from './markdown/Markdown.js';
import { ToolUse } from './components/ToolUse.js';

// 每次翻页的行数
const PAGE_LINES = 10;

export const MessageList = memo(function MessageList({ messages, scrollOffset = 0, setScrollOffset, inputDisabled = false }) {
  const { stdout } = useStdout();
  const termHeight = stdout?.rows || 24;
  // 输入框 + 状态栏 + 提示行占用约 4 行，消息区可用高度
  const viewHeight = Math.max(termHeight - 4, 4);

  // PageUp/PageDown 翻页（仅当 setScrollOffset 传入且无对话框时启用）
  useInput((_, key) => {
    if (!setScrollOffset) return;
    if (key.pageUp) {
      setScrollOffset(off => off + PAGE_LINES);
    } else if (key.pageDown) {
      setScrollOffset(off => Math.max(0, off - PAGE_LINES));
    }
  }, { isActive: !inputDisabled });

  const all = messages || [];
  const total = all.length;
  const endIdx = total - scrollOffset;
  const startIdx = Math.max(0, endIdx - viewHeight);
  const visible = all.slice(startIdx, endIdx > 0 ? endIdx : total);

  const items = visible.map((m, i) => {
    const realIdx = startIdx + i;
    if (m.role === 'user') {
      return React.createElement(Text, { key: realIdx, color: 'green' }, `user: ${m.text}`);
    }
    if (m.role === 'tool') {
      return React.createElement(ToolUse, {
        key: realIdx,
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
      return React.createElement(Text, { key: realIdx, color: 'red' }, `error: ${m.text}`);
    }
    // assistant 消息：streaming 用 StreamingMarkdown，完成用 Markdown
    const indicator = m.streaming ? '▌' : '●';
    const content = m.streaming
      ? React.createElement(StreamingMarkdown, null, m.text || '')
      : React.createElement(Markdown, null, m.text || '');
    return React.createElement(
      Box,
      { key: realIdx, flexDirection: 'row' },
      React.createElement(Text, { color: m.streaming ? 'yellow' : 'cyan' }, indicator + ' '),
      React.createElement(Box, { flexDirection: 'column' }, content)
    );
  });

  return React.createElement(Box, { flexDirection: 'column' },
    scrollOffset > 0 && React.createElement(Text, { dimColor: true },
      `↑ 向上翻看历史 (第 ${startIdx + 1}-${Math.min(endIdx, total)}/${total} 条)  PageDown 向下`),
    ...items
  );
});
