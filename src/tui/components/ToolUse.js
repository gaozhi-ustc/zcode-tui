import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

// 工具调用的闪烁加载指示器（500ms 闪烁周期，对齐 Claude Code 的 useBlink）
function useBlink(active) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!active) { setOn(true); return; }
    const timer = setInterval(() => setOn(v => !v), 500);
    return () => clearInterval(timer);
  }, [active]);
  return on;
}

/** 摘要工具输入参数（截断长内容）。 */
function summarizeInput(input) {
  if (!input || typeof input !== 'object') return '';
  // 常见工具字段优先
  if (input.command) return truncate(typeof input.command === 'string' ? input.command : JSON.stringify(input.command), 80);
  if (input.file_path || input.path || input.filePath) return input.file_path || input.path || input.filePath;
  if (input.pattern) return `/${input.pattern}/`;
  if (input.prompt) return truncate(input.prompt, 60);
  if (input.url) return input.url;
  if (input.query) return truncate(input.query, 60);
  const keys = Object.keys(input);
  if (keys.length === 0) return '';
  if (keys.length <= 2) return keys.map(k => `${k}: ${truncate(String(input[k]), 30)}`).join(', ');
  return keys.slice(0, 3).join(', ') + '...';
}

function truncate(s, max) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** 摘要工具结果（截断长输出）。 */
function summarizeResult(result, isError) {
  let text = '';
  if (typeof result === 'string') text = result;
  else if (Array.isArray(result)) text = result.map(r => typeof r === 'string' ? r : r?.text || JSON.stringify(r)).join('\n');
  else if (result && typeof result === 'object') text = result.text || result.output || JSON.stringify(result);
  else text = String(result || '');
  return truncate(text, 200);
}

/**
 * 单个工具调用展示组件。
 * @param {object} props
 * @param {string} props.toolName - 工具名
 * @param {object} props.toolInput - 工具输入参数
 * @param {*} props.result - 工具结果（null=进行中）
 * @param {boolean} props.error - 结果是否为错误
 * @param {boolean} props.streaming - 是否在流式中
 */
export function ToolUse({ toolName, toolInput, result, error, streaming }) {
  const inProgress = result == null && streaming !== false;
  const blink = useBlink(inProgress);

  const dot = error ? '✗' : inProgress ? (blink ? '●' : ' ') : '✓';
  const dotColor = error ? 'red' : inProgress ? 'yellow' : 'green';

  const summary = summarizeInput(toolInput);

  return React.createElement(
    Box,
    { flexDirection: 'column', paddingLeft: 1 },
    React.createElement(
      Box,
      { flexDirection: 'row' },
      React.createElement(Text, { color: dotColor }, dot + ' '),
      React.createElement(Text, { bold: true, color: 'cyan' }, toolName),
      summary && React.createElement(Text, { dimColor: true }, ` ${summary}`)
    ),
    result != null && !error && React.createElement(
      Text,
      { dimColor: true, paddingLeft: 2 },
      summarizeResult(result, error)
    ),
    error && result != null && React.createElement(
      Text,
      { color: 'red', paddingLeft: 2 },
      summarizeResult(result, error)
    )
  );
}

export default ToolUse;
