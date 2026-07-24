import React, { memo } from 'react';
import { Text, Box, useInput, useStdout } from 'ink';
import { MessageItem } from './MessageItem.js';
import { stringWidth } from './markdown/string-width.js';

// 每次翻页的行数
const PAGE_LINES = 10;

/** 文本在指定宽度下的渲染行数（按 stringWidth 折算 CJK 宽字符）。 */
function visualLines(text, width) {
  let n = 0;
  for (const seg of String(text || '').split('\n')) {
    n += Math.max(1, Math.ceil(stringWidth(seg) / width));
  }
  return n;
}

/** 取文本的尾部若干行（折算视觉宽度），用于截断超高单条消息。 */
function tailLines(text, maxRows, columns) {
  const w = Math.max(columns - 2, 8);
  const lines = String(text).split('\n');
  const kept = [];
  let rows = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = Math.max(1, Math.ceil(stringWidth(lines[i]) / w));
    if (rows + cost > maxRows && kept.length > 0) break;
    rows += cost;
    kept.unshift(lines[i]);
  }
  return kept.join('\n');
}

/** 估算一条消息的渲染行数（用于视口行预算裁剪，允许高估不可低估）。 */
function estimateMessageLines(m, columns) {
  const full = Math.max(columns, 8);
  if (m.role === 'user') return visualLines('user: ' + (m.text || ''), full);
  if (m.role === 'error') return visualLines('error: ' + (m.text || ''), full);
  if (m.role === 'tool') {
    let n = 1; // 头部行
    if (m.result != null) n += 4; // 结果折叠到 3 行 + 提示行
    const ti = m.toolInput || {};
    if (ti.old_string != null && ti.new_string != null) {
      const d = String(ti.old_string).split('\n').length + String(ti.new_string).split('\n').length;
      n += Math.min(d, 10) + (d > 10 ? 1 : 0);
    }
    if (m.stdoutTail) n += 1;
    if (m.stderrTail) n += 1;
    return n;
  }
  // assistant：指示符占 2 列
  const w = Math.max(columns - 2, 8);
  let n = visualLines(m.text || '', w);
  if (m.reasoning) n += m.reasoningExpanded ? visualLines(m.reasoning, w) + 1 : 1;
  return n;
}

/** 消息的稳定 key：mid/toolCallId 优先，否则用其在完整列表中的位置。 */
export function messageKey(m, globalIdx) {
  if (m.mid != null) return `mid-${m.mid}`;
  if (m.toolCallId != null) return `tc-${m.toolCallId}`;
  return `${m.role}-${globalIdx}`;
}

/**
 * 动态消息列表：渲染传入的消息（当前为「在飞后缀」），
 * 按渲染行数预算从尾部裁剪，PageUp/PageDown 翻页。
 */
export const MessageList = memo(function MessageList({ messages, scrollOffset = 0, setScrollOffset, inputDisabled = false, indexBase = 0 }) {
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
  // 先按消息条数粗切（控制布局成本）
  const MAX_MESSAGES = Math.max(viewHeight, 15);
  const endIdx = total - scrollOffset;
  const startIdx = Math.max(0, endIdx - MAX_MESSAGES);
  const windowed = all.slice(startIdx, endIdx > 0 ? endIdx : total);

  // 再按渲染行数预算从尾部裁剪：保证消息区渲染高度 ≤ 视口，
  // 配合动态区高度锁定，杜绝 ink 溢出帧全清（tmux 闪烁根因）。
  // 注意：ink 的 overflow 裁剪只切底部，故超出预算的单条消息必须
  // 截断文本保留尾部，不能依赖 flex-end 铺底。
  const termWidth = stdout?.columns || 80;
  const visible = [];
  let budget = viewHeight;
  for (let i = windowed.length - 1; i >= 0; i--) {
    const cost = estimateMessageLines(windowed[i], termWidth);
    if (visible.length > 0 && budget - cost < 0) break;
    budget -= cost;
    visible.unshift(windowed[i]);
  }
  // 单条消息超出整个预算：截断其文本为尾部 viewHeight 行（仅文本类消息）
  if (visible.length === 1 && budget < 0 && visible[0].role !== 'tool') {
    const m = visible[0];
    visible[0] = { ...m, text: tailLines(m.text || '', viewHeight, termWidth) };
  }
  const cutStartIdx = endIdx - visible.length;

  const items = visible.map((m, i) => {
    const realIdx = cutStartIdx + i;
    return React.createElement(MessageItem, { key: messageKey(m, indexBase + realIdx), message: m });
  });

  return React.createElement(Box, { flexDirection: 'column' },
    scrollOffset > 0 && React.createElement(Text, { dimColor: true },
      `↑ 向上翻看历史 (第 ${startIdx + 1}-${Math.min(endIdx, total)}/${total} 条)  PageDown 向下`),
    ...items
  );
});

export default MessageList;
