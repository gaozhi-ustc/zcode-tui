import React from 'react';
import { Text, Box, useInput, useStdout } from 'ink';

// 每次翻页的行数
const PAGE_LINES = 10;

export function MessageList({ messages, scrollOffset = 0, setScrollOffset }) {
  const { stdout } = useStdout();
  const termHeight = stdout?.rows || 24;
  // 输入框 + 状态栏 + 提示行占用约 4 行，消息区可用高度
  const viewHeight = Math.max(termHeight - 4, 4);

  // PageUp/PageDown 翻页（仅当 setScrollOffset 传入时启用）
  useInput((_, key) => {
    if (!setScrollOffset) return;
    if (key.pageUp) {
      setScrollOffset(off => off + PAGE_LINES);
    } else if (key.pageDown) {
      setScrollOffset(off => Math.max(0, off - PAGE_LINES));
    } else if (key.return && _.ctrl) {
      // Ctrl+Enter 回到底部
      setScrollOffset(0);
    }
  });

  // 计算可见窗口
  const all = messages || [];
  const total = all.length;
  // scrollOffset=0 表示看最新内容（底部）
  const endIdx = total - scrollOffset;
  const startIdx = Math.max(0, endIdx - viewHeight);
  const visible = all.slice(startIdx, endIdx > 0 ? endIdx : total);

  const items = visible.map((m, i) => {
    const realIdx = startIdx + i;
    if (m.role === 'user') {
      return React.createElement(Text, { key: realIdx, color: 'green' }, `user: ${m.text}`);
    }
    if (m.role === 'tool') {
      return React.createElement(Text, { key: realIdx, dimColor: true }, `  [tool] ${m.name}: ${m.text}`);
    }
    if (m.role === 'error') {
      return React.createElement(Text, { key: realIdx, color: 'red' }, `error: ${m.text}`);
    }
    // assistant 消息：streaming 时显示闪烁指示
    const indicator = m.streaming ? '▌' : '●';
    return React.createElement(Text, { key: realIdx },
      `${indicator} ${m.text || ''}`
    );
  });

  return React.createElement(Box, { flexDirection: 'column' },
    scrollOffset > 0 && React.createElement(Text, { dimColor: true },
      `↑ 向上翻看历史 (第 ${startIdx + 1}-${Math.min(endIdx, total)}/${total} 条)  PageDown 向下`),
    ...items
  );
}
