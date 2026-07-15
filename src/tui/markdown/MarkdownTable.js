import React, { memo } from 'react';
import { Box, Text, useStdout } from 'ink';
import stripAnsi from 'strip-ansi';
import wrapAnsi from 'wrap-ansi';
import { Ansi } from './Ansi.js';
import { stringWidth } from './string-width.js';

const MIN_COLUMN_WIDTH = 3;
const SAFETY_MARGIN = 4;

/**
 * Markdown 表格渲染组件。
 * 算列宽 → 拼成 box-drawing 字符串 → 整体交给 <Ansi> 渲染。
 * 对齐 Claude Code 的 MarkdownTable。
 */
export const MarkdownTable = memo(function MarkdownTable({ token }) {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns || 80;

  if (!token || !token.header) return null;

  const headerCells = token.header.map(h => stripAnsi(h.text || ''));
  const align = token.align || headerCells.map(() => 'left');
  const rows = (token.rows || []).map(r => r.map(c => stripAnsi(c.text || '')));
  const numCols = headerCells.length;

  // 计算列宽
  const allRows = [headerCells, ...rows];
  const idealWidths = [];
  for (let c = 0; c < numCols; c++) {
    let max = MIN_COLUMN_WIDTH;
    for (const row of allRows) {
      const w = stringWidth(row[c] || '');
      if (w > max) max = w;
    }
    idealWidths.push(max);
  }

  const borderOverhead = 1 + numCols * 3;
  const available = termWidth - borderOverhead - SAFETY_MARGIN;

  let columnWidths;
  let needsHardWrap = false;
  const totalIdeal = idealWidths.reduce((a, b) => a + b, 0);

  if (totalIdeal <= available) {
    columnWidths = idealWidths;
  } else {
    // 按比例缩减
    const scale = available / totalIdeal;
    columnWidths = idealWidths.map(w => Math.max(Math.floor(w * scale), MIN_COLUMN_WIDTH));
    needsHardWrap = true;
  }

  // 拼表格行
  const lines = [];

  // 顶边框
  lines.push(renderBorderLine('top', columnWidths));

  // 表头
  lines.push(...renderRow(headerCells, columnWidths, align.map(() => 'center')));
  lines.push(renderBorderLine('middle', columnWidths));

  // 数据行
  for (const row of rows) {
    lines.push(...renderRow(row, columnWidths, align));
  }

  // 底边框
  lines.push(renderBorderLine('bottom', columnWidths));

  return React.createElement(Ansi, null, lines.join('\n'));
});

function renderBorderLine(type, widths) {
  const chars = {
    top: ['┌', '┬', '┐'],
    middle: ['├', '┼', '┤'],
    bottom: ['└', '┴', '┘'],
  };
  const [left, mid, right] = chars[type] || chars.middle;
  const parts = widths.map(w => '─'.repeat(w + 2));
  return left + parts.join(mid) + right;
}

function renderRow(cells, widths, align) {
  // 每个单元格换行
  const wrapped = cells.map((cell, i) => {
    const w = widths[i] || MIN_COLUMN_WIDTH;
    const lines = wrapAnsi(cell || '', w, { hard: true, trim: false }).split('\n');
    return lines;
  });
  const maxLines = Math.max(...wrapped.map(w => w.length));

  const result = [];
  for (let line = 0; line < maxLines; line++) {
    const parts = [];
    for (let c = 0; c < cells.length; c++) {
      const text = wrapped[c][line] || '';
      const w = widths[c] || MIN_COLUMN_WIDTH;
      const a = align[c] || 'left';
      parts.push(' ' + padAligned(text, w, a) + ' ');
    }
    result.push('│' + parts.join('│') + '│');
  }
  return result;
}

function padAligned(text, width, align) {
  const displayWidth = stringWidth(text);
  const padding = Math.max(0, width - displayWidth);
  if (align === 'center') {
    const left = Math.floor(padding / 2);
    return ' '.repeat(left) + text + ' '.repeat(padding - left);
  }
  if (align === 'right') {
    return ' '.repeat(padding) + text;
  }
  return text + ' '.repeat(padding);
}

export default MarkdownTable;
