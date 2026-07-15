import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

const OPTIONS = [
  { value: 'yes', label: '允许 (y)', key: 'y' },
  { value: 'no', label: '拒绝 (n)', key: 'n' },
];

/**
 * 权限确认对话框。
 * 对齐 Claude Code 的 PermissionDialog + Select 组件。
 *
 * @param {object} props
 * @param {string} props.toolName - 请求权限的工具名
 * @param {string} props.detail - 权限请求详情（如命令、文件路径）
 * @param {function} props.onDecide - 决策回调 (decision: 'yes'|'no') => void
 */
export function PermissionDialog({ toolName, detail, onDecide }) {
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (input === 'y' || input === 'Y' || key.return) {
      onDecide('yes');
    } else if (input === 'n' || input === 'N' || key.escape) {
      onDecide('no');
    } else if (key.leftArrow || input === 'h') {
      setSelected(s => Math.max(0, s - 1));
    } else if (key.rightArrow || input === 'l') {
      setSelected(s => Math.min(OPTIONS.length - 1, s + 1));
    }
  });

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: 'yellow',
      marginTop: 1,
      paddingX: 1,
    },
    React.createElement(Text, { bold: true, color: 'yellow' }, `⚡ 权限请求: ${toolName}`),
    detail && React.createElement(Text, { dimColor: true }, detail),
    React.createElement(
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
              backgroundColor: i === selected ? 'yellow' : undefined,
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
