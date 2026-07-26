import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

const OPTIONS = [
  { value: 'yes', label: '允许 (y)', key: 'y' },
  { value: 'yes-always', label: '本工具总允许 (a)', key: 'a' },
  { value: 'no', label: '拒绝 (n)', key: 'n' },
  { value: 'type', label: '输入指令 (t)', key: 't' },
];

/**
 * 权限确认对话框。
 * 对齐 Claude Code 的 PermissionDialog + Select 组件，
 * 含 "No, and tell Claude what to do differently"（输入指令随拒绝发送）。
 *
 * 清楚展示：工具名、风险等级、具体操作内容（命令/文件路径等）、原因。
 *
 * @param {object} props
 * @param {string} props.toolName - 请求权限的工具名
 * @param {string} props.detail - 权限请求详情（多行：风险+操作+原因）
 * @param {string} props.input - 工具输入参数（原始）
 * @param {string} props.reason - server 给的原因
 * @param {function} props.onDecide - 决策回调 (decision: 'yes'|'yes-always'|'no'|'deny-feedback', feedback?: string) => void
 */
export function PermissionDialog({ toolName, detail, input, reason, queueIndex, queueTotal, onDecide }) {
  const [selected, setSelected] = useState(0);
  const [typeMode, setTypeMode] = useState(false);
  const [feedback, setFeedback] = useState('');

  // 防重由 useSessionEvents 的 respondedRpcIdsRef 统一负责，
  // 组件内 useRef guard 会随实例复用残留导致按键全失效（曾致现场死锁）
  useInput((inputKey, key) => {
    // 输入指令模式：字符/退格/Enter 提交/Esc 返回
    if (typeMode) {
      if (key.escape) {
        setTypeMode(false);
        setFeedback('');
        return;
      }
      if (key.return) {
        if (feedback.trim()) onDecide('deny-feedback', feedback.trim());
        return;
      }
      if (key.backspace || key.delete) {
        setFeedback(f => f.slice(0, -1));
        return;
      }
      // 可打印字符追加（忽略控制键）
      if (inputKey && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
        setFeedback(f => f + inputKey);
      }
      return;
    }

    if (inputKey === 'y' || inputKey === 'Y' || key.return) {
      onDecide('yes');
    } else if (inputKey === 'a' || inputKey === 'A') {
      onDecide('yes-always');
    } else if (inputKey === 'n' || inputKey === 'N') {
      onDecide('no');
    } else if (inputKey === 't' || inputKey === 'T') {
      setTypeMode(true);
    } else if (key.escape) {
      onDecide('no');
    } else if (key.leftArrow || inputKey === 'h') {
      setSelected(s => Math.max(0, s - 1));
    } else if (key.rightArrow || inputKey === 'l') {
      setSelected(s => Math.min(OPTIONS.length - 1, s + 1));
    }
  });

  // 解析详情里的各行（风险、操作、原因）
  const detailLines = (detail || '').split('\n').filter(Boolean);

  // 检测风险等级着色
  const isHighRisk = detailLines.some(l => l.includes('高风险'));
  const borderColor = isHighRisk ? 'red' : 'yellow';

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor,
      marginTop: 1,
      paddingX: 1,
    },
    // 标题行：工具名 + 队列序号
    React.createElement(
      Box,
      null,
      React.createElement(Text, { bold: true, color: borderColor }, '⚡ 权限请求: '),
      React.createElement(Text, { bold: true }, toolName),
      queueTotal > 1 && React.createElement(
        Text,
        { color: borderColor, bold: true },
        `  [${queueIndex}/${queueTotal}]`
      )
    ),
    // 详情各行
    detailLines.map((line, i) => {
      // 风险等级行着色
      if (line.includes('高风险')) {
        return React.createElement(Text, { key: i, color: 'red', bold: true }, line);
      }
      if (line.includes('中风险')) {
        return React.createElement(Text, { key: i, color: 'yellow' }, line);
      }
      if (line.includes('低风险')) {
        return React.createElement(Text, { key: i, color: 'green' }, line);
      }
      // 命令行用代码样式
      if (line.startsWith('$ ')) {
        return React.createElement(Text, { key: i, color: 'cyan' }, line);
      }
      // 其他详情
      return React.createElement(Text, { key: i, dimColor: true }, line);
    }),
    typeMode
      // 输入指令模式（对齐 Claude Code "tell Claude what to do differently"）
      ? React.createElement(
          Box,
          { flexDirection: 'column', marginTop: 1 },
          React.createElement(Text, { color: 'cyan' }, `✎ 指令: ${feedback}▌`),
          React.createElement(Text, { dimColor: true }, '[Enter] 拒绝并发送指令  [Esc] 返回')
        )
      // 选项
      : React.createElement(
          Box,
          { marginTop: 1 },
          ...OPTIONS.map((opt, i) =>
            React.createElement(
              Box,
              { key: opt.value, marginRight: 2 },
              React.createElement(
                Text,
                {
                  color: i === selected ? 'black' : undefined,
                  backgroundColor: i === selected ? borderColor : undefined,
                  bold: i === selected,
                },
                ` ${opt.label} `
              )
            )
          )
        )
  );
}

export default PermissionDialog;
